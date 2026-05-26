# Roadmap

The sequenced build plan for AUCKETS, anchored on the first beta show. The goal of this doc is to make sure work happens in the right order — foundation, then engine, then features, then polish. Skipping ahead causes rework.

This is a living document. Update it at the end of each session with what got done and what's blocked.

---

## North star

A small private beta show (~50 attendees, Cope's place or a similar untraditional venue) approximately 8–10 weeks from build start. End-to-end: fans submit offers, allocation runs, payments capture, tickets deliver, attendance is recorded. Real money, real fans, real allocation. Followed ~6 weeks later by a sectioned-off test in the 1,200-cap Austin theater.

---

## Week 1 — Foundation

**Goal: ship nothing, build everything underneath.**

- [ ] GitHub repo created, private, with the docs in this folder dropped at root.
- [ ] Branch protection on `main`: required CI checks, no force-push, require PR.
- [ ] GitHub Actions CI: typecheck, lint, test on every PR. No deploy yet.
- [ ] Next.js 14 project initialized with TypeScript strict mode (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- [ ] Tailwind set up.
- [ ] `src/lib/env.ts` with Zod-validated env vars; `.env.example` committed.
- [ ] Drizzle ORM installed, `drizzle.config.ts` configured.
- [ ] Supabase staging project created. Connection string in env.
- [ ] Clerk integrated; basic sign-up/login flow works.
- [ ] Stripe Connect account configuration confirmed (Express accounts).
- [ ] Sentry installed and capturing errors.
- [ ] Pino logger set up. Logs structured JSON.
- [ ] Inngest installed with one no-op handler to confirm wiring.
- [ ] Resend account, domain verified, one test email sends.
- [ ] Vitest configured. One trivial passing test.
- [ ] Playwright configured. One trivial passing e2e test.
- [ ] `README.md` with setup instructions.

**Exit criterion:** A new developer can clone the repo, run `npm install` and `npm run dev`, sign up via Clerk locally, and see a logged-in page. CI is green. No features yet — just the platform.

---

## Week 2 — GAE spike

**Goal: prove the engine works against real data, in isolation.**

- [ ] Read and confirm `GAE_SPEC.md` is current.
- [ ] Define all GAE types in `src/lib/gae/types.ts`.
- [ ] Implement `rankkey.ts` with unit tests.
- [ ] Implement `launchpad.ts` (greedy version) with unit tests.
- [ ] Implement `fitresolver.ts` with unit tests.
- [ ] Implement `placement.ts` with unit tests for each lean type.
- [ ] Implement `waterfall.ts` with unit tests.
- [ ] Public `allocate()` function in `src/lib/gae/index.ts`.
- [ ] **Run against the Lincoln Theatre data** (when Josh receives it from Cope). Validate output makes sense.
- [ ] Commit the Lincoln Theatre input + expected output as an integration test fixture.
- [ ] Build a small CLI script: `npm run gae:run <venue.json> <offers.json>` that runs the GAE and prints the result. Useful for debugging and showing Cope what's happening.

**Exit criterion:** The GAE produces output for the Lincoln Theatre scenario that Cope confirms is correct. All unit tests pass. No database, no API, no UI yet — just the engine.

---

## Week 3 — Schema and venue tooling

**Goal: wire the GAE to data; build the first venue.**

- [ ] Drizzle schema for all tables (see `ARCHITECTURE.md` for entity list).
- [ ] Initial migration generated and applied to staging.
- [ ] Seed script with one venue (Cope's place — built manually), one artist, a couple of test users.
- [ ] Repository layer (`src/lib/db/repositories/`) for: users, artists, venues, venueRows, shows, showSections, offers, seatAssignments, allocationLogs, bondEvents.
- [ ] Server-side function `runAllocation(showId, mode)` in `src/server/allocation.ts` that reads from DB, calls the GAE, and writes results.
- [ ] Integration test for the full round-trip: seed → submit offers → run allocation → verify DB state.
- [ ] Build the Cope's-place venue architecture by hand. Document the process in `docs/runbooks/build-venue.md`.

**Exit criterion:** Allocation can be run end-to-end against Cope's place from a test script. All seats are assigned correctly. Audit trail is complete.

---

## Week 4 — Offer submission flow

**Goal: fans can submit offers and have them stored, tokenized, and ranked.**

- [ ] Stripe SetupIntent integration. On submit, tokenize card without charging.
- [ ] `POST /api/offers` route: auth, validate, idempotency, create offer, return SetupIntent client secret.
- [ ] Fan-facing offer submission form (basic UI, polish later). One show only for MVP.
- [ ] **Auto-bid + private offer fields on the form** (ADR-0017): `auto_bid_enabled`, `auto_bid_cap_cents`, `private_threshold_cents` (optional).
- [ ] Show page reads aggregate offer stats (per Q30: totals + averages per section).
- [ ] `BOND_EVENT` appended on offer submission.
- [ ] Email confirmation on offer received.
- [ ] **SMS confirmation when fan has provided phone** (ADR-0016).
- [ ] Webhook handler for Clerk user creation/update.
- [ ] E2E test: sign up → land on show page → submit offer → see confirmation.

**Exit criterion:** A fan can sign up, see a show, submit an offer, get a confirmation email + SMS, and the offer lands in the DB with a Stripe payment method attached.

**Confirmed by v2 (was blocked, now decided — see ADRs):**
- Q12 → fans can revise upward; auto-bid + private offers are first-class (ADR-0017).
- Q14 → immediate rejection, no MVP waitlist.
- Q15 → group size cap = 10 (ADR-0011).
- Q17 → artist sets, platform default 14 days.
- NEW-1 → SetupIntent + charge on acceptance still recommended; Cope finishing research (ADR-0003 status: "pending hold-window decision").

**Add this week — Twilio for SMS (ADR-0016):**
- New foundation slice: install `twilio`, env vars `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`, dormant-without-keys `src/lib/sms/client.ts` paralleling the Resend wrapper.
- 10DLC registration (Julia drives, 1–2 week carrier turnaround).

---

## Week 5 — Allocation API and binding flow

**Goal: allocation can be triggered, runs binding, captures payments, notifies fans.**

- [ ] Inngest job: `allocation.run` triggered by API call or schedule.
- [ ] Job orchestrates: read offers, call GAE, write assignments, capture payments, send emails.
- [ ] Stripe PaymentIntent creation against SetupIntent for each accepted offer.
- [ ] Payment failure handling: status=PAYMENT_FAILED, retry window, fan notification.
- [ ] Outbid email template.
- [ ] Accepted email template with ticket details.
- [ ] Preview allocation job (non-binding) runs on a schedule (e.g., hourly, debounced on changes).
- [ ] Fan can see their projected rank via the show page.
- [ ] Manual trigger endpoint for binding allocation (admin only).

**Exit criterion:** Allocation can be triggered against a show with real offers, the GAE runs, accepted fans get charged and emailed, outbid fans get notified, everything is logged.

**Blocked on (or proceed with default):**
- NEW-2 (rolling vs batch) — default: hybrid (continuous preview + binding checkpoints).
- NEW-3 (waterfalling tiers) — default: yes, baked into GAE.

---

## Week 6 — Artist dashboard (basic)

**Goal: Cope can create a show, configure pricing, see what's happening, and request operational changes.**

- [ ] Artist login (Clerk with `ARTIST` role per ADR-0012).
- [ ] Show creation form: venue, date, sections, pricing, offer window.
- [ ] Per-section floor price configuration (pending Q19 confirmation).
- [ ] Aggregate offer stats display — totals + averages per section. Auckets sees everything; artist sees aggregates (Q30 resolved).
- [ ] Active section selector (partial-venue activation per NEW-4).
- [ ] Holds management UI: add/remove holds per row.
- [ ] **Request workflow** for pause / end-early / comp / override (ADR-0013). Files an `artist_request` row; AUCKETS admin executes.
- [ ] Post-allocation view: who's where, who's outbid, payment success rate.

**Exit criterion:** Cope can configure a real show from scratch, see offers come in, and surface operational requests to AUCKETS without engineering help.

**Confirmed by v2:**
- Q28 → Auckets controls pause/end-early; artist files a request (ADR-0013).
- Q29 → Upgrade requests flow through AUCKETS staff who email the seat-holder with a buyout offer.
- Q30 → Aggregate view for artist; full visibility for Auckets.
- Q31 → Three roles for MVP: `FAN` + `ARTIST` + `AUCKETS_ADMIN` (ADR-0012). `VENUE_STAFF` added Week 7 for Austin.

**New in v2 — slot in after dashboard basics:**
- AUCKETS admin inbox UI for executing artist requests (probably Week 6.5 / 7).
- Per-show email customization handoff workflow (Q37b, still open).

---

## Week 7 — Production hardening

**Goal: this is ready for real money on the line.**

- [ ] RBAC enforced consistently across all routes.
- [ ] Rate limiting on offer submission (per user, per show).
- [ ] Stripe webhook handler complete and idempotent.
- [ ] Observability dashboard: offer rate, allocation status, payment success, error count.
- [ ] Sentry alerts on critical errors.
- [ ] Database backups confirmed and one restore drill completed.
- [ ] Show-day runbook in `docs/runbooks/show-day.md`.
- [ ] Load test: 200 simultaneous offer submissions to a single show.
- [ ] Security review: env vars locked down, Stripe keys rotated, Clerk admin reviewed.
- [ ] Production environment created (Vercel + Supabase production project).
- [ ] Production cutover plan documented.

**Exit criterion:** We can confidently run a show with real money. All non-negotiable items in `SECURITY.md` are verified.

---

## Week 8 — First beta show

**Goal: run a real show, learn what's wrong, fix it.**

- [ ] Dress rehearsal: simulated offers from team members against a test show in staging. Allocation runs, payments capture, emails send.
- [ ] Real show goes live. ~50 attendees, Cope's place or equivalent.
- [ ] Live monitoring during the offer window.
- [ ] Allocation runs at announced checkpoint.
- [ ] Day-of: door check, attendance recording.
- [ ] Post-show: reconciliation report (offers ↔ payments ↔ assignments ↔ attendance).
- [ ] Retrospective document: what worked, what didn't, what changes are needed.

**Exit criterion:** A show happens. Fans show up. They paid the right amount. They sat in the right seats. The system held up. We have a written retro.

---

## Weeks 9–10 — Iterate

Time intentionally left undefined. Whatever the retro surfaces becomes the priority. Common candidates:
- UI polish based on real fan feedback.
- Fixes to the GAE for cases that came up in real allocation.
- Waitlist functionality if fans missed out and complained.
- Better artist dashboard tooling based on Cope's friction points.
- **Resale flow** (ADR-0014) — seller refund at original price, artist captures uplift. Schema lands in Week 3; UI here.
- **Miracle Tickets** — gifting tickets to the fell-off list. Builds on resale primitive.

---

## Weeks 11–14 — Prep for Austin

**Goal: scale up for a 1,200-cap venue test (using only some sections).**

- [ ] Venue architecture built for the Austin theater (in partnership with the venue).
- [ ] Partial-venue activation tested at scale.
- [ ] Multi-section pricing tested.
- [ ] Performance: allocation runtime measured for ~500 offers across multiple sections.
- [ ] **Rotating geo-gated QR ticket viewer** (ADR-0015) — TOTP rotation every 60s + geolocation gate.
- [ ] Door scanner web app (simple `VENUE_STAFF` tablet UI). Adds the 4th role per ADR-0012.

---

## Phase 1.5 — after Austin

Once we've shipped two real shows, the lessons inform Phase 1.5. Likely candidates:

- Waitlist support.
- SMS notifications live.
- `accept_split` for groups willing to split across rows.
- Smarter `findBestFit` algorithm if greedy is producing visible suboptimality.
- Per-artist email branding.
- Bond score visibility (with tier names, not raw scores).
- Multi-show artist dashboard improvements.

---

## Phase 2

The Bond, in full. Multiple artists onboarded. Bond ledger drives auto-accept, rewards, fan profiles. Whole separate planning exercise — not in scope here.

---

## What is explicitly NOT in any of these phases

Restating from `ARCHITECTURE.md` so it doesn't drift:

- Native mobile apps. PWA is enough.
- Real-time WebSockets. Polling is fine.
- Multi-region. US-only is fine for years.
- Custom auth, custom payments, custom queue.
- Spotify/Songkick integration. Phase 3+ if ever.
- NFT / blockchain anything. Not happening.

If a stakeholder pushes for these, point them at this doc and `ARCHITECTURE.md`. The boundary is deliberate.

---

## Updating this doc

At the end of each session, update:
- The current week's checklist with what got done.
- The "blocked on" notes if answers came in.
- Anything that moved between weeks (push something out, pull something in).

If a substantial change happens (new week added, phase reordered), note it in a `## Change log` section at the bottom with date and reason.
