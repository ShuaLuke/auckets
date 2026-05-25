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
- [ ] Show page reads aggregate offer stats (no individual visibility per Q30).
- [ ] `BOND_EVENT` appended on offer submission.
- [ ] Email confirmation on offer received.
- [ ] Webhook handler for Clerk user creation/update.
- [ ] E2E test: sign up → land on show page → submit offer → see confirmation.

**Exit criterion:** A fan can sign up, see a show, submit an offer, get a confirmation email, and the offer lands in the DB with a Stripe payment method attached.

**Blocked on (or proceed with default if not answered):**
- Q12 (can fans revise offers upward) — default: yes, up to 24h before allocation.
- Q14 (sold-out behavior) — default: immediate rejection with notification.
- Q17 (offer window length) — default: artist sets, platform default 14 days.

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

**Goal: Cope can create a show, configure pricing, see what's happening, and trigger allocation.**

- [ ] Artist login (Clerk with artist role).
- [ ] Show creation form: venue, date, sections, pricing, offer window.
- [ ] Per-section floor price configuration.
- [ ] Aggregate offer stats display (no individual visibility during window).
- [ ] Active section selector (partial-venue activation per NEW-4).
- [ ] Holds management UI: add/remove holds per row.
- [ ] Allocation trigger button (with confirmation).
- [ ] Post-allocation view: who's where, who's outbid, payment success rate.
- [ ] Manual override endpoint and UI for comping seats.

**Exit criterion:** Cope can configure a real show from scratch, see offers come in, trigger allocation, and review the result without engineering help.

**Blocked on (or proceed with default):**
- Q28 (pause/stop early) — default: yes, with notification on ending early.
- Q29 (manual override) — default: yes, post-allocation only, all logged.
- Q30 (individual offer visibility) — default: aggregate only during, full after.
- Q31 (dashboard roles) — default: ARTIST, MANAGER, STAFF, VENUE roles.

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
- SMS notifications (10DLC registration started in week 4 in parallel).
- Better artist dashboard tooling based on Cope's friction points.

---

## Weeks 11–14 — Prep for Austin

**Goal: scale up for a 1,200-cap venue test (using only some sections).**

- [ ] Venue architecture built for the Austin theater (in partnership with the venue).
- [ ] Partial-venue activation tested at scale.
- [ ] Multi-section pricing tested.
- [ ] Performance: allocation runtime measured for ~500 offers across multiple sections.
- [ ] QR ticket generation (if not yet built) — needed for door scanning at a real theater.
- [ ] Door scanner web app (simple staff-facing tablet UI).

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
