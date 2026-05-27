# Roadmap

The sequenced build plan for AUCKETS, anchored on the first beta show. The goal of this doc is to make sure work happens in the right order — foundation, then engine, then features, then polish. Skipping ahead causes rework.

This is a living document. Update it at the end of each session with what got done and what's blocked.

---

## North star

A small private beta show (~50 attendees, Cope's place or a similar untraditional venue) approximately 8–10 weeks from build start. End-to-end: fans submit offers, allocation runs, payments capture, tickets deliver, attendance is recorded. Real money, real fans, real allocation. Followed ~6 weeks later by a sectioned-off test in the 1,200-cap Austin theater.

---

## Week 1 — Foundation ✅ DONE

**Goal: ship nothing, build everything underneath.**

- [x] GitHub repo created, private, with the docs in this folder dropped at root.
- [x] Branch protection on `main`: required CI checks, no force-push, require PR.
- [x] GitHub Actions CI: typecheck, lint, test on every PR. No deploy yet.
- [x] Next.js 14 project initialized with TypeScript strict mode (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- [x] Tailwind set up.
- [x] `src/lib/env.ts` with Zod-validated env vars; `.env.example` committed.
- [x] Drizzle ORM installed, `drizzle.config.ts` configured.
- [x] Supabase staging project created. Connection string in env.
- [x] Clerk integrated; basic sign-up/login flow works.
- [ ] Stripe Connect account configuration confirmed (Express accounts). — still pending Cope's research per ADR-0003
- [x] Sentry installed and capturing errors. — wired, dormant without DSN
- [x] Pino logger set up. Logs structured JSON.
- [x] Inngest installed with one no-op handler to confirm wiring.
- [x] Resend account, domain verified, one test email sends. — client wired, dormant; domain verification still pending
- [x] Vitest configured. One trivial passing test.
- [x] Playwright configured. One trivial passing e2e test.
- [x] `README.md` with setup instructions.

**Exit criterion met:** A new developer can clone the repo, run `npm install` and `npm run dev`, sign up via Clerk locally, and see a logged-in page. CI is green. No features yet — just the platform.

---

## Week 2 — GAE spike ✅ DONE

**Goal: prove the engine works against real data, in isolation.**

- [x] Read and confirm `GAE_SPEC.md` is current.
- [x] Define all GAE types in `src/lib/gae/types.ts`.
- [x] Implement `rankkey.ts` with unit tests.
- [x] Implement `launchpad.ts` (greedy version) with unit tests.
- [x] Implement `fitresolver.ts` with unit tests.
- [x] Implement `placement.ts` with unit tests for each lean type.
- [x] Implement `waterfall.ts` with unit tests.
- [x] Public `allocate()` function in `src/lib/gae/index.ts`.
- [ ] **Run against the Lincoln Theatre data** (when Josh receives it from Cope). — pending Cope sending real data; synthetic fixtures cover the test surface
- [ ] Commit the Lincoln Theatre input + expected output as an integration test fixture. — pending Cope data
- [ ] Build a small CLI script: `npm run gae:run <venue.json> <offers.json>`. — not built; the admin "Preview allocation" button serves the same debugging purpose

**Exit criterion met (synthetically):** The GAE produces correct output against synthetic Cope's-place fixtures; unit tests pass; the production "Preview allocation" button exercises the full pipeline against real-DB seed data.

---

## Week 3 — Schema and venue tooling ✅ DONE

**Goal: wire the GAE to data; build the first venue.**

- [x] Drizzle schema for all tables (17 tables shipped; see `drizzle/schema.ts`).
- [x] Initial migration generated and applied to staging + production via Supabase MCP.
- [x] Seed script with Cope's place venue, Citizen Cope artist, sample users.
- [x] Repository layer (`src/lib/db/repositories/`) covers: users, artists, venues, venueArchitectures, shows, offers, seatAssignments, allocationLogs, artistRequests, tickets, holds, offerRevisions. (`bondEvents` deferred — comes with the Bond Phase 2.)
- [x] Server-side allocation orchestrator at `src/lib/allocation/` (`translate.ts` + `build-plan.ts` + `run-preview.ts`).
- [ ] Integration test for the full round-trip: seed → submit offers → run allocation → verify DB state. — pending integration-test infra; the production "Preview allocation" button exercises the path end-to-end manually
- [x] Cope's-place venue architecture built and seeded.

**Exit criterion met:** Allocation runs end-to-end against Cope's place via the production "Preview allocation" button. Seats are assigned, audit trail is complete, results visible in the seat map.

---

## Week 4 — Offer submission flow ⚠️ DEV STUB ONLY

**Goal: fans can submit offers and have them stored, tokenized, and ranked.**

- [ ] **Stripe SetupIntent integration.** — blocked on ADR-0003 (Cope's hold-window research)
- [x] `POST /api/offers` route (dev stub): auth, validate, create offer with placeholder Stripe IDs. Gated by `ALLOW_DEV_OFFER_STUB` env var; refused on Vercel production.
- [x] Fan-facing offer submission form — full prototype-fidelity port (stepper, price, tier radios, auto-bid toggle, rank-key preview).
- [x] Auto-bid fields on the form (ADR-0017): `auto_bid_enabled`, `auto_bid_cap_cents`, `auto_bid_increment_cents`.
- [x] Private-threshold field on the offer schema (ADR-0017) — server-only; UI surfacing pending.
- [x] Show page reads aggregate offer stats (offers count, tickets count, median, top, tier breakdown, distribution histogram).
- [ ] `BOND_EVENT` appended on offer submission. — `bond_events` table not yet shipped; comes with Phase 2.
- [ ] Email confirmation on offer received. — template not built; Resend wired but dormant.
- [ ] **SMS confirmation when fan has provided phone** (ADR-0016). — Twilio not installed.
- [ ] Webhook handler for Clerk user creation/update. — using lazy `ensureUserMirror` on POST routes for now.
- [ ] E2E test: sign up → land on show page → submit offer → see confirmation. — Playwright smoke covers sign-in only.

**Status:** A fan CAN sign up, see Cope's place, submit an offer through the dev stub on preview deploys, and land back on /dashboard with the yourOffer chip. The /my-bids page shows the full revision history of every offer via `offer_revisions`. Real Stripe-backed submission and notifications wait on ADR-0003 + Twilio + Resend domain verification.

**Confirmed by v2 (was blocked, now decided — see ADRs):**
- Q12 → fans can revise upward; auto-bid + private offers are first-class (ADR-0017).
- Q14 → immediate rejection, no MVP waitlist.
- Q15 → group size cap = 10 (ADR-0011).
- Q17 → artist sets, platform default 14 days.
- NEW-1 → SetupIntent + charge on acceptance still recommended; Cope finishing research (ADR-0003 status: "pending hold-window decision").

**Twilio for SMS (ADR-0016) — not yet started:**
- Install `twilio`, env vars `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`, dormant-without-keys `src/lib/sms/client.ts` paralleling the Resend wrapper.
- 10DLC registration (Julia drives, 1–2 week carrier turnaround) — also not started; this is the long pole for SMS-at-MVP.

---

## Week 5 — Allocation API and binding flow ⚠️ PREVIEW ONLY

**Goal: allocation can be triggered, runs binding, captures payments, notifies fans.**

- [ ] Inngest job: `allocation.run` triggered by API call or schedule. — manual button only today; Inngest has placeholder `hello-world` function only.
- [x] `POST /api/shows/[id]/allocate?mode=preview` — admin-only, runs GAE, writes seat_assignments + allocation_logs.
- [ ] **`mode=binding` path** — endpoint returns 501; blocked on ADR-0003.
- [ ] Stripe PaymentIntent creation. — blocked on ADR-0003.
- [ ] Payment failure handling (`PAYMENT_FAILED` status, retry window, fan notification). — schema column exists; flow not built.
- [ ] Outbid email template. — not built.
- [ ] Accepted email template with ticket details. — not built.
- [ ] Preview allocation job on a schedule. — manual-trigger only via the ShowAdmin "Preview allocation" button. Continuous compute is a future slice.
- [x] Fan can see their projected rank via the show page. — yourOffer chip on /dashboard, rank-key preview on show page.
- [x] Manual trigger endpoint for binding allocation (admin only). — preview path shipped; binding path is the same endpoint with `mode=binding`, currently 501.

**Status:** The GAE runs from the UI today. Admins click "Preview allocation" → seats get placed → the ShowAdmin page refreshes with new BigStats, capacity bar, recent activity, and seat map. Binding allocation (which charges cards and issues tickets) is the next big slice but waits on ADR-0003.

**Blocked on (or proceed with default):**
- NEW-2 (rolling vs batch) — default: hybrid (continuous preview + binding checkpoints).
- NEW-3 (waterfalling tiers) — default: yes, baked into GAE.

---

## Week 6 — Artist dashboard ✅ DONE (read side) ⚠️ partial (write side)

**Goal: Cope can create a show, configure pricing, see what's happening, and request operational changes.**

- [x] Artist login (Clerk; `ARTIST` and `AUCKETS_ADMIN` roles supported per ADR-0012).
- [ ] **Show creation form**: venue, date, sections, pricing, offer window. — NOT BUILT. Shows are seeded by SQL today.
- [ ] **Per-section floor price configuration** (pending Q19 confirmation). — NOT BUILT.
- [x] Aggregate offer stats display — totals + averages per section. ArtistDashboard + ShowAdmin both show comprehensive aggregates.
- [x] Active section selector (partial-venue activation per NEW-4). — `activeRowIds` plumbed through repos + presenters + UI.
- [ ] **Holds management UI**: add/remove holds per row. — read-only HoldsCard ships; write-path (Add hold dialog + DELETE) is a parked follow-up.
- [x] **Request workflow** for pause / end-early / comp / override (ADR-0013). — POST /api/artist-requests + RequestActionButton dialog shipped. Admin inbox UI for execution is the next slice (in progress at handoff time).
- [x] Post-allocation view: ShowAdmin shows BigStats (placed/unplaced/orphans/fill rate), seat map, activity feed including PLACED/SKIPPED/ORPHAN_DETECTED events.

**Status:** Cope can sign in, see his shows, drill into Cope's place, see live aggregates / seat map / activity / tier breakdown / distribution histogram / holds. He can file Request actions for pause/end-early/comp/override. He CANNOT yet create new shows or build new venues without engineering help.

**Confirmed by v2:**
- Q28 → Auckets controls pause/end-early; artist files a request (ADR-0013). ✅ shipped.
- Q29 → Upgrade requests flow through AUCKETS staff who email the seat-holder with a buyout offer.
- Q30 → Aggregate view for artist; full visibility for Auckets. ✅ shipped.
- Q31 → Three roles for MVP: `FAN` + `ARTIST` + `AUCKETS_ADMIN` (ADR-0012). `VENUE_STAFF` added Week 7 for Austin.

**Follow-up slices remaining:**
- AUCKETS admin inbox UI for executing artist requests — in progress at handoff time.
- Per-show email customization handoff workflow (Q37b, still open).
- ShowCreate + VenueBuilder for artist self-service.

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
