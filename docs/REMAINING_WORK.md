# Remaining work — cross-walk against the design

A snapshot of what's shipped vs what's not, organized by impact and blocker chain. Pair this with [`CONTEXT.md`](CONTEXT.md) ("Current state") and [`ROADMAP.md`](ROADMAP.md) (week-by-week plan).

Updated 2026-05-27 after PR #50 (notifications scaffold) merged and the integration-test infra slice opened.

---

## TL;DR

**Roughly 25–30% of the prototype is shipped, all on the read side.** Everything that touches money, real ticket delivery, scanning, resales, or notifications is unbuilt.

**ADR-0003 update (2026-05-27):** Locked in a working assumption — offer windows ≤6 days + auth-based hold — so the downstream Stripe chain (real `POST /api/offers` → binding allocation → tickets → card-failure recovery → resale) is now buildable. Items 8-15 below move from 🔴 → 🟡 (operationally buildable but pending Cope confirmation of the assumption). See the 2026-05-27 note in [DECISIONS.md ADR-0003](DECISIONS.md#adr-0003--stripe-setupintent--charge-on-acceptance).

---

## Screen cross-walk (14 screens in `design/ui_kits/auckets/screens/`)

| Screen | Status | Path | Effort to finish |
|---|---|---|---|
| **Landing.jsx** | Stub | `src/app/page.tsx` (32 lines, logo + signup button) | small–medium |
| **SignUpModal.jsx** | ✅ Functional via Clerk | `/sign-in`, `/sign-up` (Clerk's built-in modal, not the prototype style) | cosmetic only |
| **Dashboard.jsx** (fan) | ✅ Close to fidelity | `src/app/(fan)/dashboard/page.tsx` | small (microcopy polish) |
| **Show.jsx** (fan show detail) | ⚠️ Works via dev stub | `src/app/(fan)/shows/[showId]/page.tsx` | medium (live preview, venue map, rank board on the right column) |
| **TicketViewer.jsx** | ❌ Not built | — | large (ADR-0015: rotating TOTP QR + geo gate) |
| **ResaleFlow.jsx** | ❌ Not built | — | large (ADR-0014 anti-scalping mechanics) |
| **CardFailure.jsx** | ❌ Not built | — | medium (blocked on Stripe being in) |
| **ArtistDashboard.jsx** | ✅ Close to fidelity | `src/app/(artist)/artists/[artistId]/page.tsx` | small (omitted "New show" button — depends on ShowCreate) |
| **ShowAdmin.jsx** | ✅ Most of it shipped | `src/app/(artist)/artists/[artistId]/shows/[showId]/page.tsx` | small–medium (Fans · data export tab pending) |
| **ShowCreate.jsx** | ❌ Not built | — | medium (form + `POST /api/shows`) |
| **VenueBuilder.jsx** | ❌ Not built | — | large (rows, capacity, parity, lean, tier, holds builder) |
| **Allocation.jsx** | ❌ Not built | — | small–medium ("you're in the room" confirmation page after submit) |
| **AllocationFinal.jsx** | ❌ Not built | — | medium (fan "placed / not placed" result page after binding) |
| **Scanner.jsx** | ❌ Not built | — | large (door-staff scan app; paired with TicketViewer) |

---

## Design components → UI primitives

Located at `src/components/ui/`. Most are ported; two notable gaps:

| Design component | Status |
|---|---|
| `Button` | ✅ ported (primary, brand, secondary, ghost, inverse) |
| `Field`, `TextInput`, `Stepper`, `RadioGroup` | ✅ ported |
| `Card` | ✅ ported (default, warm, sunken, inverse, outline variants) |
| `Badge` | ✅ ported (placed/preview/pending/skipped/unplaced/open/upcoming/inverse) |
| `Eyebrow` | ✅ ported |
| `Tag` | ⚠️ inlined inside `HoldsCard`, not promoted to a shared primitive |
| `Header` / nav | ❌ Not ported. `src/app/layout.tsx` hand-rolls a header with Clerk buttons; the design's role-switcher + nav structure isn't reproduced |
| `Icon` set | ❌ Not ported as a unit. We import individual lucide-react icons ad-hoc instead of using the design's named icon set |

---

## Email templates (5 designed)

| Template | Built in `src/lib/email/templates/`? | Wired to send? |
|---|---|---|
| `welcome.html` | ✅ welcome.tsx | ❌ no trigger |
| `offer-received.html` | ❌ | ❌ |
| `placed.html` | ❌ | ❌ |
| `not-placed.html` | ❌ | ❌ |
| `allocation-imminent.html` | ❌ | ❌ |

`sendEmail()` exists in `src/lib/email/client.ts` but stays dormant without `RESEND_API_KEY`. No Inngest job or route handler currently calls it for any user-facing event.

**Effort:** medium — 4 React Email components + 4 trigger points + verify auckets.com domain in Resend.

---

## Cross-cutting systems

| System | Status | Notes |
|---|---|---|
| **Stripe / payments** | ⚠️ Buildable against working assumption | No Stripe SDK import, no PaymentIntent, no webhook handler, no payment-method storage. **Path unblocked by 2026-05-27 ADR-0003 working assumption** (≤6-day offer windows + `PaymentIntent` with `capture_method: "manual"`). Offer submission still goes through the dev stub that fakes `stripe_payment_method_id` / `stripe_setup_intent_id`; the real path ships in its own slice. |
| **Notifications — Resend (email)** | ⚠️ Client wired, dormant | 1 of 5 templates exists; nothing fires today. |
| **Notifications — Slack** | ❌ Not built | No webhook integration. Internal ops alerts (card failures, allocation runs, artist requests) have no notification path. |
| **Notifications — Twilio / SMS** | ❌ Not built | ADR-0016 moved SMS to MVP. No Twilio SDK, no 10DLC registration. **Long pole** — 1–2 week carrier turnaround. |
| **Tickets** | ⚠️ Data only | Schema has the `tickets` table, repositories can read tickets and present seat assignments. No QR generation, no rotating-token logic, no geo-validation, no fan-facing ticket viewer. |
| **Scanner** | ❌ Not built | Door-entry app; paired with TicketViewer. Needs `VENUE_STAFF` role (per ADR-0012, added for Austin). |
| **Resales** | ❌ Not built | No resale schema events, no refund logic, no artist-uplift routing, no Miracle Tickets gift flow. |
| **Binding allocation job** | ❌ Not built | `POST /api/shows/[id]/allocate?mode=binding` returns 501. The engine runs preview-only today. |

---

## What IS live (positive context)

Comprehensive read-side coverage + the bid-submit dev stub. From the prototype:

- ✅ The full **fan-side bid flow** end-to-end on Vercel preview deploys (real submit on Vercel production still refuses pending the real Stripe path; ADR-0003 working assumption now lets that path be built)
- ✅ The full **artist-side ShowAdmin** experience minus the Fans tab — including BigStats, recent activity (with live GAE decisions interleaved), tier breakdown, distribution histogram, provisional placement seat map, holds & manifest (read-only)
- ✅ The full **/my-bids fan history** with offer-revision history (every change to every offer captured by `offer_revisions` inside the upsert transaction)
- ✅ **Admin-only "Preview allocation" button** that runs the real GAE end-to-end and refreshes the page with new placements
- ✅ **Artist request action** dialog and endpoint for pause/end-early/comp/override per ADR-0013 (admin-side execution is the next slice)
- ✅ **GAE itself** — all five modules complete and tested (types, rank-key, launchpad, fit-resolver, placement, waterfall, allocate() entry point)
- ✅ **17-table Drizzle schema** including the newly added `offer_revisions` and `holds`. RLS enabled deny-all on every public table.
- ✅ **CI gates:** typecheck + lint + ~392 unit tests + build on every PR, plus a parallel `integration` job that runs the real-Postgres suite (`tests/integration/`, currently covering `upsertOfferForUser` + the artist-request concurrency guard)

---

## Priority-ordered remaining work

### 🟢 Unblocked admin/artist polish — small slices, no external dependencies

These can ship at any time, in any order. Each is a 1-PR slice.

1. **Admin inbox UI** for ops to execute / deny `artist_requests` (the filing side ships; the execute side is open). Server-component page at `/admin/requests`, AUCKETS_ADMIN-gated, per-request execute/deny endpoints. *In progress at handoff time.*
2. **Add hold dialog + DELETE** flow. Schema is ready (`holds` table, `kind='venue'|'artist'`). Need: POST/DELETE endpoints + client dialog (similar shape to RequestActionButton) + trash icon wired up. Range compaction in seat-number formatting ("1-4" for contiguous) can land here too.
3. **Revision diffs in the activity feed.** Activity feed currently shows "Revision · offer_xxxx · now $40 × 4". `presentOfferHistory` already builds "$30 → $40" diffs for /my-bids. Pull `listOfferRevisionsByOfferIds` into the ShowAdmin page and pair adjacent revisions in `presentRecentActivity`.
4. **Fans · data export tab** on ShowAdmin (the Fans tab from `ShowAdmin.jsx`). Per-fan rows with email/phone/group/offer/status/seats + CSV export + "Email all N" action. **Needs a privacy review first** per ADR-0017 (private offer fields are server-only — confirm what's safe to expose).

### 🟡 Blocked operationally — start whenever external work clears

5. **Notifications wiring**:
   - Resend domain verification (`auckets.com` in Resend) — operational
   - 4 missing email templates (offer-received, placed, not-placed, allocation-imminent)
   - Slack webhook for #ops (request-filed, card-failure, allocation-run alerts)
   - Twilio + SMS (long pole: 10DLC registration is 1–2 weeks of carrier turnaround)
6. **ShowCreate** — form + `POST /api/shows` so Cope (or any artist) can create a show without engineering help.
7. **VenueBuilder** — surface for editing venue architecture (rows, capacity, parity, lean, tier). Needed before any new venue (Austin, etc.).

### 🟡 Buildable against the 2026-05-27 ADR-0003 working assumption

Per the working assumption (≤6-day windows + `PaymentIntent` with `capture_method: "manual"`), these become buildable. **The assumption is not yet Cope-confirmed**, so anything built here would need a revisit if his research lands elsewhere. Listed in dependency order.

8. **Real `POST /api/offers` with `PaymentIntent` (manual capture)** — replaces the dev stub. Idempotency keys (table already exists), card auth held for the offer window (≤6 days), payment-method storage.
9. **Binding allocation job** — `mode=binding` path on `/api/shows/[id]/allocate`. Captures placed offers' PaymentIntents, cancels auths for unplaced offers, transitions offer + show statuses.
10. **Inngest schedule** for binding allocation at the announced checkpoint (T-24h before doors).
11. **TicketViewer** — rotating TOTP QR (60s rotation per ADR-0015) + geolocation gate. Fan-facing route at `/tickets/[id]` or similar.
12. **Scanner** — door-staff app. Camera/QR scan UI, scan log, attendance recording. `VENUE_STAFF` role gating per ADR-0012.
13. **CardFailure recovery** — 2% card-failure window. Notification, retry, hold-the-seat logic. (Less common with auth-based holds since the auth has already validated the card, but cards can still get cancelled between auth and capture.)
14. **Resale flow** — refund seller at original, route uplift to artist (ADR-0014). Miracle Tickets (gift mode) builds on this primitive.
15. **AllocationFinal** — fan-facing "placed / not placed" result page after a binding run.

### 🔵 Polish (any time, post-MVP)

16. **Landing page** full build-out — hero, "How it works," FAQ, marketing copy. *Re-prioritized 2026-05-27 — see audit queue below.*
17. **Header / nav redesign** — role-switcher, design-system header.
18. **Icon system** consolidation — promote `Icon` as a shared primitive instead of ad-hoc lucide-react.
19. **Allocation confirmation page** ("You're in the room" after submit).
20. **Bond Phase 2** — `bond_events` table + ledger + auto-accept + rewards + fan profiles. Out of MVP scope per ROADMAP.

---

## 🔎 From 2026-05-27 design-vs-shipped audit

Five UI-fidelity gaps surfaced during a deep audit of the 14 prototype screens (`design/ui_kits/auckets/screens/`) against the 9 shipped pages. Ordered by cost-vs-payoff. Each maps back to a bucket above.

1. **Landing page rebuild** (🟢 → reclassifies #16, ~250 LOC, 1 PR) — single biggest visible gap. Today `src/app/page.tsx` is a 32-LOC stub; the design has 6 sections (hero w/ HeroTicketCard, "How it works" 3-up, comparison band, "For artists" black section w/ JSON allocation_log preview, 6-Q FAQ, footer). All static content, no backend dependencies. FAQ copy in `Landing.jsx` is canonical AUCKETS-voice and answers questions you'd otherwise field manually — worth shipping ahead of any traffic push.
2. **ShowAdmin tabbed shell** (🟢, refactor only) — the artist `/shows/[id]` page currently stacks all 6 cards vertically; design uses 5 tabs (Overview / Distribution / Provisional placement / Holds / Fans). Pure presentation refactor of existing cards into a tab pattern. No new data needed. Reduces the page's vertical scroll significantly.
3. **Show detail right column — `RankBoard`** (🟢, 1 PR) — 3-up stat card ("Your rank #X / N", "Median offer", "Capacity %"). All three derivable from existing repos (`getOfferStatsForShow`, `getProvisionalFilledByShow`); only new query is per-user rank within a show's offer pool.
4. **Show detail right column — `PreviewBanner` + `VenuePreview`** (🟢-ish, 1–2 PRs) — "You'd land in Premium · Row A · seats 7–15" banner plus the seat map with "your seats" highlighted in green. Needs to hook the GAE preview-mode into the fan view (the existing `PreviewAllocationButton` already runs preview as admin; this surfaces the same engine inline for the fan). `DisplacementToast` is a 3rd right-column component but needs polling or push to detect rank drops — best held back as a follow-up after the static pieces ship.
5. **ArtistDashboard cell re-align** (split 🟢/🔴) — current `SnapshotStats` substitutes *Provisional payout* → *Tickets in pool* and *Capacity filled* → *Top offer* because the real numbers aren't computable yet. Capacity-filled needs a cross-show seat-capacity aggregate query (🟢 — can ship now). Provisional payout needs Stripe fee math (🔴 — blocked on ADR-0003 because the fee math depends on the payment-method storage decision).

Already covered elsewhere; not re-listed:

- Fans · data export tab on ShowAdmin — already #4 above, gated on privacy review per ADR-0017.
- TicketViewer / Scanner / ResaleFlow / CardFailure / AllocationFinal — already in the 🔴 section.
- ShowCreate / VenueBuilder — already in the 🟡 section.

---

## How to use this doc

When a slice ships:
1. Move the relevant item from a 🔴/🟡 section up to the "What IS live" list.
2. Update `CONTEXT.md` "Current state" if the change is meaningful (new page, new schema table, new external service).
3. Update `ROADMAP.md` checkboxes for the relevant week.

When a new external service or decision lands:
1. Move the relevant 🔴 items to 🟡 or 🟢.
2. Note in `OPEN_QUESTIONS.md` that the question is resolved and link to the ADR.

When in doubt, the order to evaluate priorities is: **safety (RLS / auth / Stripe correctness) → bid-flow operability → polish.**
