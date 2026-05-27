# Decisions

This is the architectural decision log. Each entry records a choice we made, the alternatives we considered, and the reasoning. The point is to keep future-you (and future collaborators) from relitigating settled questions.

New decisions go at the bottom with the next sequential number. Once written, an ADR is not deleted — if we change our minds, we add a new ADR that supersedes the old one and mark the old one as superseded.

Format: number, title, status, date, decision, reasoning, alternatives, consequences.

---

## ADR-0001 — Single Next.js app, not microservices

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Build AUCKETS as a single Next.js 14 app with API routes, server actions, and one Postgres database. No separate backend service. No microservices.

**Reasoning:** We are a solo developer at MVP. Microservices solve organizational problems (team boundaries) and scaling problems we do not have. A monolith is faster to build, easier to reason about, and trivial to split later if a real boundary emerges. The GAE module is structured so it could be extracted to a separate service later without rewriting the interface.

**Alternatives:**
- Separate Node/Express backend behind the Next.js frontend. Adds deployment complexity and a network hop with no benefit.
- Serverless function per concern. Same problem, more pieces.

**Consequences:** All code in one repo. One deploy. One log stream. One set of secrets. When we hit scale problems, we revisit — but probably not for years.

---

## ADR-0002 — Drizzle over Prisma

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Use Drizzle ORM for database access.

**Reasoning:** Drizzle has near-zero cold-start time on serverless, generates predictable SQL, and lets us drop into raw SQL when the GAE needs it. Prisma is more popular and has a slightly nicer DX for simple CRUD, but its Rust query engine adds 200-500ms of cold start on Vercel, the generated client is large, and it makes complex queries harder to express.

For a system where allocation correctness matters and we may need row-level locking and window functions, Drizzle is the better fit.

**Alternatives:**
- Prisma. Fine choice. We picked Drizzle for the reasons above, but if you arrive here finding Prisma half-built, the answer is to stop and finish in Drizzle — not switch.
- Raw SQL with `postgres.js`. Too much boilerplate at our scale.
- Knex / Kysely. Kysely is good; Drizzle has slightly better TypeScript inference and a healthier ecosystem.

**Consequences:** Migrations are managed via `drizzle-kit`. Schema lives in `drizzle/schema.ts` as the single source of truth.

---

## ADR-0003 — Stripe: SetupIntent + charge on acceptance

**Status:** Accepted, working assumption: ≤6-day offer window + auth-based hold (pending Cope confirmation)
**Date:** 2026-05-25 (original) · 2026-05-27 (working-assumption note)

**Decision:** When a fan submits an offer, we create a Stripe SetupIntent to tokenize their card. We do **not** create a PaymentIntent or place a hold. When allocation runs and the offer is accepted, we create a PaymentIntent against the saved payment method and confirm immediately.

**Reasoning:** Stripe payment intents in `requires_capture` state (pre-auths/holds) expire after 7 days for most card networks. Our offer windows may exceed this — Cope wants flexibility to open offer windows weeks in advance. The alternatives are all worse:

- **Periodic re-authorization:** every 5-6 days, cancel and recreate the intent. Visible to cardholders in their banking app. Can fail. ~1 week of engineering for an annoying flow.
- **Capture immediately + refund losers:** terrible UX (fan is debited even though they may not get tickets). Disrupts cash flow.
- **Short offer windows only:** sacrifices product flexibility for technical simplicity.

SetupIntent + charge on acceptance is the standard modern ticketing pattern. The tradeoff is that ~2% of charges fail at allocation time (expired cards, insufficient funds), and we need a "card declined, please update" flow. This is acceptable and expected.

**Alternatives:** see above.

**Consequences:** We need a payment-failure handling flow. We need a grace window (proposed: 24 hours) for fans whose cards fail to update payment and reclaim their seats before they go back to the pool.

**2026-05-25 note:** Cope flagged "still outstanding need to do research on this" in v2. The SetupIntent path stands as the recommendation; if Cope's research lands on "keep offer windows ≤ 6 days and use a normal Stripe pre-auth," we revisit. Don't ship the offer-submission flow (Week 4) until this is settled.

**2026-05-27 note — working assumption:** Per Julia (via session handoff), we're locking in **offer windows ≤ 6 days + auth-based hold** as a working assumption to unblock downstream development. This is the alternative the 2026-05-25 note anticipated. Implementation path under this assumption:

- Offer submit creates a Stripe `PaymentIntent` with `capture_method: "manual"` (an auth-only hold) for the offer's full amount (price × group_size).
- The auth holds the fan's funds for ≤6 days, within Stripe's 7-day reliable-auth window for most card networks.
- At binding allocation (T-24h before doors), placed offers get their PaymentIntent captured; unplaced offers get the auth cancelled (funds released, fan pays $0).
- No SetupIntent on the happy path; SetupIntent stays as the documented fallback if Cope eventually wants windows > 6 days, in which case we'd revert to "SetupIntent + charge at acceptance" per the original ADR body above.

**This assumption is not confirmed by Cope yet.** It's recorded here so subsequent slices (real `POST /api/offers`, binding allocation job, ticket issuance, card-failure recovery, resale) can build against a concrete model rather than block. Once Cope confirms (or rejects) the ≤6-day constraint, this note becomes the canonical decision OR we revert to the SetupIntent body above and revisit the slices built against the assumption.

**What this unblocks today:** queue items 8–15 in [REMAINING_WORK.md](REMAINING_WORK.md) move from 🔴 to 🟡. The dev stub (`ALLOW_DEV_OFFER_STUB`) stays in place until the real path ships and is verified.

---

## ADR-0004 — Hybrid allocation: continuous preview + binding checkpoints

**Status:** Accepted (pending Cope confirmation)
**Date:** 2026-05-25

**Decision:** Allocation runs in two modes:

1. **Preview mode** runs continuously (Inngest job, debounced, every few minutes). It computes what allocation *would* look like with the current offer pool. Results are non-binding. Fans see "your projected rank" or "you would currently be placed in row X." No emails sent, no payment captured.
2. **Binding mode** runs at announced checkpoints (e.g., 24 hours before door, then again at door time). This is the real allocation. Payments are captured, seats are assigned, fans are notified of accepted/outbid/waitlisted status.

**Reasoning:** The original spec described "rolling acceptance" — every new offer triggers re-allocation. This creates a serious UX problem: a fan can be told they're accepted, then displaced by a higher offer that arrives later. The HFC build had the inverse problem (zones operate independently with no cascading). Neither is right.

Hybrid gives fans the "live market" feeling (they can see where they currently stand and react) without the "I had tickets, now I don't" disaster. Binding checkpoints make the financial reality clean: one moment everyone learns their status, payments capture as a batch, emails go out together.

**Alternatives:**
- True rolling: too volatile, bad UX, hard to reason about.
- Single allocation at door time: too late, no opportunity for fans to bid up after seeing where they stand.
- Multiple binding checkpoints throughout the window: too many "is this final?" moments. Two is enough.

**Consequences:** The GAE supports a `mode: 'preview' | 'binding'` flag. Preview writes a separate `allocation_previews` table; binding writes to `seat_assignments` and `allocation_logs`. Fans see real signal in the UI without it being legally binding until the checkpoint.

**Status note:** This is the recommended approach pending explicit confirmation from Cope. If Cope strongly prefers true rolling, we revisit. See `OPEN_QUESTIONS.md` NEW-2.

---

## ADR-0005 — Inngest for background jobs

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Use Inngest for all background work: allocation runs, payment captures, email batches, scheduled jobs, retries.

**Reasoning:** Vercel functions have execution time limits (10s hobby, 60s pro, 300s enterprise). A full-venue allocation could exceed this on a 1,200-seat venue. Beyond that, we need: durability (jobs survive deploys), retries (transient failures), scheduling (checkpoints), and observability (which jobs ran, when, with what result). Inngest gives us all of this with a clean TypeScript SDK and a free tier sufficient for MVP.

**Alternatives:**
- Trigger.dev — similar product, also good. We picked Inngest mostly on developer experience and event-driven model fit. Either would work.
- Vercel Cron + Postgres-based queue — viable but DIY; we'd build observability and retries ourselves.
- A dedicated worker service — overkill at our scale.

**Consequences:** Inngest is a hard dependency. Their outage = our background jobs paused. We mitigate by having the binding allocation checkpoint be triggerable manually (from an admin route) as a fallback.

---

## ADR-0006 — Clerk for auth

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Use Clerk for authentication.

**Reasoning:** Auckets already has a Clerk account from the previous build. Clerk handles email/password, magic links, social login (Google, Apple), MFA, and provides webhooks for syncing users to our database. The Next.js App Router integration is well-supported. The earlier suggestion to use Supabase Auth instead is overridden by the practical fact that Clerk is already set up and the team is familiar with it. Switching auth providers to save a few dollars is the wrong tradeoff.

**Alternatives:**
- Supabase Auth — fine, free with the Postgres we already have, but no reason to switch off Clerk.
- Auth.js (NextAuth) — fine, but more wiring required.
- Custom — never.

**Consequences:** Clerk webhooks sync users into our `users` table. Roles and permissions live in our database, not in Clerk. Clerk knows *who*; we know *what they can do*.

---

## ADR-0007 — Money as integer cents, always

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** All monetary values in code, in the database, and in API contracts are integers representing cents. Never floats. Never strings. Never decimal libraries.

**Reasoning:** Floating-point arithmetic on money causes well-documented bugs. Decimal libraries solve the math but introduce serialization complexity. Integer cents is the universal pattern for systems that handle money; it works everywhere (JSON, Postgres, Stripe), it cannot accumulate floating-point error, and it is trivially convertible to display strings at the UI boundary.

`$42.50` → `4250`. `$0.01` → `1`. Done.

**Alternatives:** None worth considering.

**Consequences:** UI code converts to display at the last moment. Stripe operates in cents natively. Postgres column type is `integer` (or `bigint` if we ever expect a transaction over $21M, which we don't). Helpers in `src/lib/money.ts` for formatting.

---

## ADR-0008 — TypeScript strict mode

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** `tsconfig.json` has `"strict": true`, plus `"noUncheckedIndexedAccess": true` and `"exactOptionalPropertyTypes": true`.

**Reasoning:** Type safety is the cheapest insurance we have. Strict mode catches the bugs that the looser settings don't. `noUncheckedIndexedAccess` in particular prevents the "array[i] is definitely defined" assumption that's wrong roughly half the time.

**Alternatives:** Loosening strict to ship faster. Pays for itself in days.

**Consequences:** Slightly more verbose code in some places. Far fewer runtime errors.

---

## ADR-0009 — Zod for all input validation

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Every API route, server action, and Inngest handler validates its inputs with Zod schemas before doing anything else. Schemas live next to the handler.

**Reasoning:** Untrusted input is the source of most security bugs and most "weird state" bugs. Zod gives us runtime validation with TypeScript inference for free. No exceptions to this rule — even "internal" endpoints validate, because today's internal endpoint is tomorrow's externally-reachable bug.

Environment variables are also validated with Zod via `@t3-oss/env-nextjs` in `src/lib/env.ts`, so missing env vars fail at build time instead of at 2am.

**Alternatives:**
- Yup / Joi — both fine, Zod has better TypeScript integration.
- No validation — never.

**Consequences:** Every route has a 5-10 line schema block at the top. Worth it.

---

## ADR-0010 — Idempotency keys on offer submission

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Offer submission accepts an `Idempotency-Key` header (UUID generated by the client). The server stores the result keyed by this UUID for 24 hours; a duplicate submission with the same key returns the original response without creating a new offer or a new Stripe SetupIntent.

**Reasoning:** Mobile fans on flaky networks will double-tap submit. Without idempotency, we get duplicate offers, duplicate Stripe customer tokens, and a confused fan with two pending charges. This is a classic pattern, costs half a day to implement up front, and saves a lot of pain.

Stripe natively supports idempotency keys on PaymentIntent and SetupIntent creation; we propagate our key down to Stripe so the entire chain is idempotent.

**Alternatives:**
- Client-side debouncing only — doesn't help across page reloads or browser tab duplicates.
- Server-side detection by (user, show, timestamp) — fragile and hard to get right.

**Consequences:** Schema includes an `offer_idempotency_keys` table or column (TBD during implementation).

---

## ADR-0011 — Group-size cap = 10

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** The platform default for `AllocationConfig.maxGroupSize` is `10`. Artists can override per show. Groups larger than 10 are routed out-of-band ("contact for booking") rather than into the offer flow.

**Reasoning:** The original working assumption (in v1 OPEN_QUESTIONS and the GAE spec) was 8. Cope's v2 answer set the default at 10 with admin override. 10 covers a few more real-world group cases (extended families, small corporate groups) without bleeding into the territory where the allocation engine's row-filling logic starts to struggle for typical small-venue row sizes (10–20 seats).

The `rankKey` formula's `* 1000` multiplier still has plenty of headroom — group sizes ≤ 999 never bleed into the price ordering. No formula change needed.

**Alternatives:**
- **Keep at 8.** Loses a few real bookings to the out-of-band flow that don't need to be there.
- **No cap at all.** Allocation pathologies for groups of 15+ become a real problem on smaller venues. Not worth it for the rare case.

**Consequences:**
- Update [`GAE_SPEC.md`](GAE_SPEC.md) references from 8 to 10.
- Update the stale comment in [`src/lib/gae/rankkey.ts`](../src/lib/gae/rankkey.ts) ("groups over 8").
- When offer submission lands (Week 4), the Zod schema validates `groupSize ≤ 10` by default, with an artist-override field on the show.

---

## ADR-0012 — RBAC roles (MVP)

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** MVP ships three roles: `FAN` (implicit default for any authenticated user), `ARTIST`, and `AUCKETS_ADMIN`. A fourth role, `VENUE_STAFF`, is added when the Austin show's door-scanner work begins (~Week 7). The design system's proposed `MANAGER` and `STAFF` roles are deferred indefinitely; we add them when a real delegation case appears.

**Reasoning:** Cope's v2 answer was "artist dashboard + Auckets admin login." That's two roles plus the implicit fan role. The design system's `TECHNICAL_INTEGRATION.md` proposed four (`ARTIST`, `MANAGER`, `STAFF`, `VENUE`), which is YAGNI for the first show — neither Cope's team nor any other artist has asked for sub-artist delegation, and we have no real use case to design against. `VENUE_STAFF` is the one extra role we know we'll need (door scanners at Austin), so it's on the calendar.

Roles live in our database, not in Clerk. The Clerk JWT carries the role for fast middleware checks; the source of truth is a `role` column on `users` (or a `user_roles` join table if we ever need multi-role users).

**Alternatives:**
- **Four roles now (`ARTIST` / `MANAGER` / `STAFF` / `VENUE`).** Premature. Two of them have no use case.
- **No roles, just `is_admin: boolean`.** Doesn't scale past Cope as the only artist.
- **Use Clerk's organization feature for artists.** Could be the answer when multi-artist lands. Not needed yet.

**Consequences:**
- [`src/middleware.ts`](../src/middleware.ts) protects the routes by role: `/dashboard` for any authenticated user, `(artist)` routes for `ARTIST`, `(admin)` routes for `AUCKETS_ADMIN`.
- Clerk webhook handler (Week 4) sets the initial role to `FAN` on `user.created`.
- Promoting a user to `ARTIST` or `AUCKETS_ADMIN` is a manual operation for now (a `scripts/promote-user.ts` or a Drizzle Studio edit) — automated promotion can wait.

---

## ADR-0013 — Auckets-controlled pause and end-early

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Pausing the offer window and ending it early are **operational actions taken by AUCKETS staff**, not direct artist controls. The artist dashboard surfaces a "Request to pause" / "Request to end early" workflow that files an `artist_request` row; an `AUCKETS_ADMIN` reviews and executes.

**Reasoning:** Cope's v2 answer to Q28: "Aucket is the one that has control not the artist here – they can submit request and we will do it." Several reasons this is the right call for MVP:

1. **Safety net.** Allocation runs are real money. A misclicked "end now" by the artist is a worse outcome than a 30-minute Auckets-staff turnaround.
2. **Audit trail.** Every pause / end-early has a human at AUCKETS making the call, captured in `artist_requests` with reasoning.
3. **Smaller MVP dashboard.** The artist UI doesn't need a "danger zone" with end-the-show buttons.

This will likely flip to direct artist controls in Phase 2 once we trust the patterns. For now, the friction is the feature.

**Alternatives:**
- **Direct artist controls with a confirm dialog.** Faster for the artist, but no human safety net.
- **Direct artist controls with a 5-minute "undo" window.** Better than no-undo but adds significant complexity.

**Consequences:**
- Schema has an `artist_requests` table (kind: `pause` | `end_early` | `comp` | `override` | ...).
- Week 6 artist dashboard scope shrinks: no "pause" or "end now" buttons, instead a "request" form.
- AUCKETS admin UI has an inbox of pending requests with one-click "execute" / "deny."
- `allocation_logs` records `MANUAL_OVERRIDE` actions linked to the `artist_requests` row when executed.

---

## ADR-0014 — Resale capped at original price

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** When a fan resells their ticket on AUCKETS, they receive **the original price they paid, no more**. Any uplift between the original price and the new price goes to the artist. The resale appears in the pool as a new offer; the buyer is the next-best unplaced offer (or open submission) at the resale price.

**Reasoning:** Cope's v2 answer to Q10: "you can though resell it on the website (they just get their money back though if the price goes up)." The anti-scalping promise built into AUCKETS is structural here — if the seller can capture markup, the platform is just another StubHub. By routing the uplift to the artist, the seller can exit cleanly (get their money back) and the artist captures any genuine demand shift.

This is the same primitive the design system's `TECHNICAL_INTEGRATION.md` § 2.12 calls "resale with capped appreciation, artist takes uplift." Confirmed by Cope.

**Alternatives:**
- **Seller keeps the uplift.** Standard StubHub model. Contradicts AUCKETS's positioning. Out.
- **Platform takes the uplift.** Adversarial to artists. Out.
- **No resale at all.** Punishes fans whose plans change. The current resale-at-original handles this cleanly.

**Consequences:**
- Schema has a `resales` table linking the original offer, the new offer, and the artist appreciation amount.
- When a resale is initiated, the original ticket goes back into the pool (binding allocation runs again for that seat).
- Refund to seller is `min(original_price, new_price)`. The delta goes to the artist's Stripe Connect account via a separate transfer.
- "Miracle Tickets" (gifting your seat to someone on the fell-off list) is a separate primitive built on the same resale plumbing — refund the seller their original price, no charge to the recipient.

---

## ADR-0015 — Rotating geo-gated QR ticket

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Tickets are displayed in the AUCKETS web app as a **TOTP-derived QR code that rotates every 60 seconds**, gated by the fan's browser geolocation being within a configurable radius of the venue. Screenshots are useless after the rotation window. Static printable tickets are not supported.

**Reasoning:** Cope's v2 answer to Q34: "QR code is changes every minute (cope wants it so that the qr code to be accessed through auckets site and its only valid when they are close to the venue)." This addresses two failure modes the existing ticketing world has: (1) ticket screenshots forwarded by scalpers, and (2) tickets sold "in front of the venue" outside the AUCKETS resale flow.

**Implementation shape** (per `TECHNICAL_INTEGRATION.md` § 7):
- TOTP secret generated at ticket-issue time, stored on the `tickets` row (base32, 32 chars). Standard `otplib` library.
- 60-second rotation window (Cope's preference). RFC 6238 default is 30s; we go longer for fan-readability.
- Geolocation gate: `navigator.geolocation` → server-side haversine vs. venue coordinates. Default radius 500m, per-venue configurable.
- **We do not store the fan's coordinates** beyond the request. Log only pass/fail and distance bucket. Privacy-by-design.
- Server-side scan validates: TOTP matches, ticket is `issued`, not already-scanned.

**Backup procedures:** If location is denied or the phone dies, venue staff can look up the fan by name + ID at the door and override. All overrides logged. (Required for the 1,200-cap Austin show; small Cope's-place show can probably skip the geo gate entirely.)

**Alternatives:**
- **Static QR code with one-time validation at scan.** Same anti-double-scan story, but screenshots forwarded by scalpers still work until the door. Cope explicitly rejected this.
- **Apple/Google Wallet passes.** Useful UX, but doesn't solve the screenshot problem. Could layer on top of TOTP later.
- **Geolocation only at scan time, no rotation.** Doesn't prevent the resale-outside-the-app case.

**Consequences:**
- `tickets` table has `totp_secret TEXT NOT NULL` and timestamps.
- New deps when ticket viewer ships: `otplib`, `qrcode`.
- Ticket viewer is `'use client'` (geolocation API, rotating display).
- `venues` table has `geo_lat`, `geo_lon`, `geo_radius_m` columns.
- For Cope's place (small private show, fans probably escorted to seats), the geo gate is configurable to "off" so we don't risk locking out fans whose phones fail the geolocation prompt.

---

## ADR-0016 — SMS at MVP via Twilio

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** SMS is a launch-day notification channel, not Phase 1.5. We integrate Twilio for transactional SMS (outbid, accepted, allocation imminent, payment failed). Fans capture phone optionally after first offer; SMS sends only to fans who provided a number.

**Reasoning:** Cope's v2 answer to Q36: "Needs to be both email and sms." This reverses the original [working assumption](OPEN_QUESTIONS.md) of "email at MVP, SMS in Phase 1.5." Rationale Cope didn't have to articulate but is true: outbid notifications are time-sensitive (the fan might want to raise their offer in the next few hours), and email open-rates can lag by hours. SMS delivery is near-instant.

**Operational long pole:** **10DLC registration** for A2P SMS in the US takes 1–2 weeks for carrier approval. Start this the week of Slice 10 so it's done by the time we wire SMS sends (Week 4 alongside email).

**Alternatives:**
- **Twilio vs. Resend SMS.** Resend's SMS product is newer and less battle-tested; Twilio is the default for a reason.
- **Email only at MVP.** Originally proposed; Cope's answer reverses this.
- **Push notifications instead of SMS.** Requires native app or PWA opt-in. Worse delivery; deferred.

**Consequences:**
- Add `twilio` to `package.json` and `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` to env validation.
- New `src/lib/sms/client.ts` parallels `src/lib/email/client.ts` — dormant without keys, logs the missing-credential case.
- 10DLC registration is operational, not engineering — Julia drives this in parallel with the build.
- Notification dispatch in Inngest handlers: send-email AND send-sms in the same step, both behind try/catch so one provider failing doesn't block the other.

---

## ADR-0017 — Auto-bid + private offers

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** Two related features ride on top of the basic offer:

1. **Auto-bid.** A fan can submit an offer with `auto_bid_enabled: true` and `auto_bid_cap_cents: N`. When their offer is displaced by a higher offer at preview time, the system automatically increments their price (default $5) up to `N` to reclaim a placement. The fan is notified at each auto-raise.

2. **Private offers (hidden price).** A fan can submit an offer with a `private_threshold_cents` field. The displayed offer price is whatever the fan publicly committed (or a floor). If any other offer in the pool exceeds the threshold, the private offer auto-converts to that price and is placed. The threshold is not visible to other fans.

**Reasoning:** Cope's v2 answer to Q12 includes both:
> "Would be cool if they could customize these triggers, do automatic bid increases. Also 'make a private offer' where if someone bids enough they get it automatically – this price is not visible though."

Auto-bid is the standard "eBay sniping prevention" mechanic, ported to a fairness-first market. Private offers solve the "I'd pay $200 for this but I don't want to broadcast that" case — high-intent fans can quietly commit without distorting the visible pool.

**Alternatives:**
- **No auto-bid.** Fans manually re-bid every time they're outbid. Pessimal UX, gameable.
- **No private offers.** Loses high-intent revenue from fans who don't want to publicly price-anchor.
- **Make the auto-bid increment artist-configurable.** Probably eventually. MVP default $5; revisit if data says otherwise.

**Consequences:**
- `offers` schema gets `auto_bid_enabled boolean`, `auto_bid_cap_cents integer`, `private_threshold_cents integer NULL`.
- Preview allocation logic runs auto-bid evaluation: any displaced auto-bid offer with headroom raises to the next price that would re-place it.
- Private offers participate in the visible aggregate stats at their *visible* price, not their threshold. The threshold is server-only state.
- Auto-bid trigger emits an event for the notification dispatcher (the fan gets an email/SMS at each raise).
- Auto-bid cap is hard — once hit, no further auto-raises, fan is treated as a normal outbid offer.

---

## How to add a new ADR

1. Pick the next sequential number.
2. Write the title as a short imperative ("Use X for Y").
3. Fill in status (Proposed / Accepted / Superseded), date, decision, reasoning, alternatives, consequences.
4. If the new ADR supersedes an old one, update the old one's status to "Superseded by ADR-NNNN" — don't delete.
5. If the decision affects code conventions, also update `CONVENTIONS.md`. If it affects architecture, also update `ARCHITECTURE.md`.

Decisions worth recording are ones that:
- A new collaborator would otherwise question.
- Took longer than 30 minutes to make.
- Have a non-obvious tradeoff.

Decisions not worth recording: which color to use for a button, which variable name reads better.
