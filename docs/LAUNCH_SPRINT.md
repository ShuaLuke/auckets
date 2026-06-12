# Launch sprint tracker — 10 days to launch (started 2026-06-11)

The single to-do list for the launch push. Source: the 2026-06-11 full-codebase review
(five parallel deep reviews: GAE, money path, security, concurrency, ops) plus the
UI/branding review (live screenshots, design system, fan journey, motion). Pick up any
session from here. Target launch: ~2026-06-21.

**How to use:** work top-to-bottom within a tier. One slice = one PR = one worktree
(see CLAUDE.md). When something ships, check it off with the PR number.

---

## ✅ Shipped 2026-06-11 (waves 1 + 2 — eleven PRs, all merged)

| PR | What |
|---|---|
| #114 | Offer retry no longer cancels the fan's own PaymentIntent; Idempotency-Keys namespaced by userId |
| #115 | Binding gate is an atomic two-step CAS (open→closed claim before pool read; closed→allocating in the Phase-1 tx) — double-run and pause-stomp closed |
| #116 | Launch hardening: prod refuses to boot with missing Stripe/Inngest env or stray INNGEST_DEV; `upload_env` gitignored; postgres `max:1`; `totpSecret` log redaction. PR body has the **prod env checklist** |
| #117 | Card-failure recovery races closed (atomic `recovering` claim, guarded expiry cron, webhook duplicate-delivery dedupe). Migration `0006_recovering_claim` applied to Supabase |
| #118 | Copy pack: FAQ de-jargoned, honest post-submit copy, `/my-bids`→`/offers` (permanent redirect), emails rebuilt, hero headline flipped positive |
| #119 | Trust pack: branded Clerk auth, favicon/apple icon, OG card + on-voice metadata, fonts via next/font |
| #120 | **Critical:** per-show holds now reach the GAE on all three paths (binding/preview/projection) — comps were being sold and charged. `shows.show_holds` confirmed vestigial |
| #121 | **Critical:** waterfall tier index built from ACTIVE rows only (fans were stranded while active seats sat empty); spec's missing fixtures added (Lincoln Theatre, 50-seat GA, partial-activation) |
| #122 | Feel pack: button/card hover+press states, MarqueeButton keyboard parity, 5 loading skeletons, branded 404, 390px shows-row fix, displacement-alert animation |
| #123 | **Critical:** binding Phase 2 is resumable — settlement derived from DB state, per-offer idempotent Inngest steps, deterministic Stripe idempotency keys, stuck-`allocating` recovery sweep. Ops runbook in the PR body |
| #124 | The dial is an instrument: seats glide/pop, prices count up, tier crossfade, custom slider with tier-floor ticks, computing pulse |

**auckets.com is the live production domain as of 2026-06-11** (DNS on Vercel; `NEXT_PUBLIC_APP_URL=https://auckets.com`). #125 (metadataBase from env) merged same day, so social cards resolve on the real domain.

---

## 🔴 Tier 0 — ops, minutes of work, gates everything (Josh)

- [ ] **CRITICAL (found 2026-06-12): production runs Clerk DEVELOPMENT keys** (`pk_test_…trusty-koala-1.clerk.accounts.dev`). Dev instances are rate-limited and handshake-redirect on a real domain — this is the prime suspect for auckets.com's recurring zero-byte hangs (clerkMiddleware stalls before any byte is sent; bursts of 307s in the logs are the handshake loop) and for the artist being unable to sign in/create a show. Fix: create a Clerk **production instance** for auckets.com (Clerk dashboard → clone dev instance), add the DNS records it asks for (Vercel DNS), set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…` + `CLERK_SECRET_KEY=sk_live_…` in Vercel prod, redeploy. **Then re-seed identity**: prod-instance user IDs are NEW — after Josh/Julia/Cope first sign in, re-grant `AUCKETS_ADMIN` roles in `users` and re-create Cope's `artist_members` row (the one added 2026-06-12 points at his dev-instance ID).
- [x] `favicon.ico` 404s on auckets.com *(fixed in #130 — real multi-size ICO at `src/app/favicon.ico`, plus `/apple-touch-icon.png` and `/robots.txt`, whose conventional-path 404s were spamming the prod error log with Clerk noise on every crawler probe)*.

- [x] **Set 3 Vercel production env vars** *(done 2026-06-11 — production deploys READY, all 11 PRs live)*: `STRIPE_WEBHOOK_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, then redeploy. Production deploys fail loudly-by-design (#116) until these exist — **all eleven merged PRs are queued behind this**. Full checklist in PR #116's body.
- [x] Rename Clerk app "My Application" → **AUCKETS** (Clerk dashboard; the sign-in headline reads from it).
- [x] Resend: verify `auckets.com` + set `RESEND_API_KEY` in prod (all fan lifecycle emails are wired but dormant).
- [x] Set `NEXT_PUBLIC_SENTRY_DSN` in prod (Sentry is fully wired, dormant without it).
- [ ] Pre-beta ops from CLAUDE.md *(in progress 2026-06-11)*: separate prod Supabase project — **created**, confirm prod env vars point at it; revoke HFC's Stripe access — **Julia revoking now**, confirm done.

## 🟠 Tier 1 — code, before real money (security/reliability)

- [x] **Wedged-DB-connection hangs (diagnosed 2026-06-12, recurring in prod)** *(shipped #128)*: a warm lambda's postgres connection gets stuck mid-protocol (`pg_stat_activity` shows Supavisor connection `active` + `ClientRead` for minutes), and because routes map to a handful of lambdas, *whichever routes that lambda serves hang with zero bytes* while the rest of the site works — observed twice 2026-06-12; `pg_terminate_backend` fixed it instantly, then it re-wedged within the hour. Fix landed client-side (a server `statement_timeout` can't fire in a `ClientRead` wedge — the server is waiting on *us* — and postgres.js has no built-in query timeout): every query gets a 15s deadline, whole transactions 60s, plus `max_lifetime: 300`; on a blown deadline the singleton swaps in a fresh client and destroys the wedged one, so the lambda self-heals instead of waiting for a manual kill. See `src/lib/db/deadline-client.ts` + PR #128 body. The audit half came up clean — no fire-and-forget `db.*` calls, no nested-transaction deadlocks. The likely freeze *trigger* is still the Tier-0 Clerk dev-keys item.

- [ ] **Rate limiting** on `POST /api/offers`, `/api/offers/[id]/recover`, `/api/scan` (offers returns granular decline codes → card-testing oracle) + enable **Stripe Radar** card-testing rules (ops half).
- [ ] **Job-failure alerting**: `onFailure` handlers on the 5 Inngest functions → Slack webhook; today a failed binding sweep is a pino warn nobody reads.
- [ ] **Pre-binding `payment_failed` poisons an offer**: webhook flips a pool offer to `card_failure`; a revision doesn't reset status → fan silently excluded from allocation with a live auth (webhook.ts ~168, offers repo upsert).
- [ ] **Scan door-window check**: VENUE_STAFF is global — any staff can scan any show any time. Minimum fix: `/api/scan` rejects tickets whose show isn't within its doors window.
- [ ] Wire the `offer_idempotency_keys` table (exists in schema, zero reads/writes) for app-level submission dedupe.
- [ ] Add an **e2e job to CI** (Playwright smoke spec exists but never runs in CI).
- [ ] Status CHECK constraints on `shows`/`offers`/`tickets` status columns; enforce per-show `maxGroupSize` at the offer route (Zod caps at global 10 only).

## 🟡 Tier 2 — UI slices remaining (the captivation list)

- [ ] **UI-5 — liveness** (the heart): one read-only polling endpoint (~20s) feeding (a) live "min offer to get in" with flash-on-change, promoted from the tiny header stat to the dial; (b) room fill breathing on the map; (c) **the fan's own projected seat re-projected live** as other offers land, with animated movement + live displacement alerts (ships the deferred DisplacementToast). Design guardrail: a setback must always read as "here's what happened + the one action that fixes it" (+$X nudge / auto-raise) — informative, never panicky.
- [ ] **UI-6 — the climax**: link `/allocation/[showId]` from the placed/not-placed emails and dashboard (it is currently ORPHANED — no fan path reaches it), and make the placed state a real celebration (distinct from the consolation screen, which today differs only by a shade of gray).
- [ ] **UI-7 — ticket stub**: tour-poster type treatment + serial-number flourish, pointer tilt + sheen, conic countdown ring on the 60s QR rotation with crossfade, collapse the two dead buttons into one "coming soon" line. Plus the OfferPlaced email seat line ("Orchestra · Row AA · seats 7–10") — needs plumbing through the binding notifier (deferred from #118).
- [ ] **UI-8 — imagery + hero** (partially gated on NEW-15 decision): artist/show imagery with greenwood duotone (shows index, show hero, ticket stub, landing); landing hero gets a live animated `LiveRoomMap` demo of the dial; brand shell (design-kit sticky header, wordmark lockup, footer on inner pages); `/shows` as an artist-first lineup.
- [ ] Dynamic per-show OG cards (`opengraph-image.tsx` per show — poster-style; static brand card shipped in #119).
- [ ] Small follow-ups: `.eslintrc.json` needs `"root": true` (nested-worktree lint breaks — flagged repeatedly by agents); internal `Bid*` symbol sweep (repo/presenter names; fan-visible strings already clean); seed shows at realistic evening times.

## 🔵 Product decisions needed (Cope/Julia — don't build past these)

- [ ] **Auto-bid money semantics**: (a) a fan whose auto-bid climbed but lost the section is charged the raised price for a worse tier; (b) the last partial increment is never used ($58 cap with $5 steps stops at $55). Both deterministic today; need explicit sign-off or a change.
- [ ] **NEW-15 imagery**: artist photo enough for show #1, or per-show poster override?
- [ ] **Geo-gating posture ADR**: the QR geo-gate is client-trusted only (no server-side geo check exists; a stale comment in TicketViewer claims otherwise — fix the comment with the ADR). Decide if v1 accepts this.
- [ ] Dark "stage light" show-page header direction (mock first); font pairing confirm (recommend keeping Bricolage/Geist).
- [ ] **Composer direction feedback (Josh, 2026-06-12)**: (a) tapping a seat on the map should show what that seat is currently going for (what its occupant is being charged right now) — natural fit with UI-5's polling endpoint, but needs a privacy/comfort call on exposing another fan's live price per seat vs. a per-section/tier figure; (b) Josh doesn't love the slider — revisit the dial's input mechanism (UI-4 shipped a custom range slider; consider direct seat-tap-to-offer as the primary gesture, with the dial secondary).

## ⚪ Known-accepted risks (documented, not blocking)

- No refund machinery (`charge.refunded` recorded as `ignored`); ops refunds via Stripe dashboard leave DB stale — acceptable while volume is tiny, revisit with resales.
- Binding >6.5 days after earliest auth would mass-fail captures (auth expiry); creation-time window check + short windows make this unlikely pre-beta.
- Allocation-imminent email dedup is best-effort (cron band tiling).
- `AllocationConfig` knobs (`rngSeed`, `orphanPolicy`…) are dead — group cap enforced by schema CHECK instead.

---

## Where the full detail lives

- Money/concurrency/security findings + fixes: PR bodies of #114–#117, #120, #121, #123.
- Prod env runbook: PR #116 body. Stuck-show runbook: PR #123 body.
- UI master list with effort sizes: the 2026-06-11 session transcript; condensed here.
- Product context: `docs/REMAINING_WORK.md` (broader roadmap), `docs/OPEN_QUESTIONS.md` (NEW-15 etc.).
