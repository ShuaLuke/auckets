# AUCKETS — Context

**Read this file at the start of every session before writing any code.** It is the source of truth for what AUCKETS is, what we are building, and what to do next. Other docs in this repo go deeper on specific areas (see "Companion docs" at the bottom).

---

## What AUCKETS is

AUCKETS is a dynamic ticket allocation marketplace for live music. Fans submit offers (group size + price per ticket). The Greenwood Allocation Engine (GAE) ranks all offers, walks the venue from best row to worst, and places groups intelligently — keeping groups together, avoiding orphan seats, and respecting offer rank. The market determines both price and placement.

It is **not** an auction. There is no countdown timer, no per-ticket bidding war, no "winning at different prices in the same zone." It is a single, venue-wide ranked allocation that runs at announced checkpoints (with a continuous non-binding preview between checkpoints, so fans can see where they would currently land).

This matters because a previous implementation (HFC) built a per-ticket eBay-style auction with independent zones and a closing-time cron job. That is fundamentally a different product from what AUCKETS is. Do not pattern-match to anything from that build.

## Who this is for

- **Cope (Clarence Greenwood)** — artist, product owner, vision-holder. Citizen Cope.
- **Josh** — technical lead. Solo developer for now; design for a small team joining later.
- **Julia, marketing person** — admin and operations.
- **Fans** — submit offers, get seated, attend shows.

## Tech stack (locked in)

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript, strict mode |
| Database | PostgreSQL via Supabase |
| ORM | Drizzle |
| Auth | Clerk (Auckets already has an account) |
| Payments | Stripe (Connect Express accounts for artists) |
| Email | Resend (React Email templates) |
| Background jobs | Inngest |
| Hosting | Vercel |
| Error tracking | Sentry |
| Styling | Tailwind CSS |
| Validation | Zod everywhere |
| Logging | pino (structured JSON) |
| Tests | Vitest (unit), Playwright (e2e) |

If you find yourself wanting to swap one of these out, stop and write an ADR in `docs/decisions/` first. Don't just change it.

## Project structure

```
auckets/
├── docs/
│   ├── decisions/           # Numbered ADRs (Architecture Decision Records)
│   ├── runbooks/            # Operational procedures
│   └── architecture.md      # Detailed system architecture
├── drizzle/
│   ├── schema.ts            # Single source of truth for DB schema
│   ├── migrations/          # Generated migration files
│   └── seed.ts              # Test data seeder
├── src/
│   ├── app/
│   │   ├── (fan)/           # Fan-facing pages
│   │   ├── (artist)/        # Artist dashboard pages
│   │   ├── (admin)/         # Admin panel pages
│   │   └── api/             # Server-side API routes
│   ├── lib/
│   │   ├── gae/             # Greenwood Allocation Engine — ISOLATED, PURE LOGIC
│   │   │   ├── rankkey.ts
│   │   │   ├── launchpad.ts
│   │   │   ├── fitresolver.ts
│   │   │   ├── placement.ts
│   │   │   ├── waterfall.ts
│   │   │   └── types.ts
│   │   ├── jobs/            # Inngest handlers
│   │   ├── stripe/          # Stripe client + helpers
│   │   ├── email/           # Resend + React Email
│   │   ├── auth/            # Clerk helpers
│   │   ├── db/              # Drizzle client
│   │   ├── logger.ts        # pino instance
│   │   └── env.ts           # Zod-validated env vars
│   ├── server/              # Route handlers / business logic
│   ├── components/          # Shared React components
│   └── types/               # Shared TypeScript types
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/                 # One-off operational scripts
├── .github/workflows/       # CI
├── CONTEXT.md               # This file
├── ARCHITECTURE.md
├── DECISIONS.md
├── CONVENTIONS.md
├── GAE_SPEC.md
├── ROADMAP.md
├── OPEN_QUESTIONS.md
├── SECURITY.md
├── RUNBOOK.md
└── README.md
```

## Prime directives — never violate these

1. **The GAE is isolated.** All allocation logic lives in `src/lib/gae/`. No HTTP, no UI, no Stripe, no database calls. Pure functions: input venue + offers, output assignments + log. This is what makes it testable and swappable.
2. **All allocation runs server-side.** Never trust the client with rank, price, or seat assignment.
3. **Money is integers in cents.** Never floats. Never strings. Always `int` representing cents.
4. **Zod validates every API input.** No exceptions.
5. **Auth is checked on every route.** Then authorization. Then business logic.
6. **Stripe webhooks verify signatures.** And every handler is idempotent.
7. **Bond events are append-only.** Never update, never delete. The score is a SUM. The formula can change; history cannot.
8. **Allocation decisions are logged in `allocation_logs` with full snapshot.** Every PLACED, SKIPPED, FIT_RESOLVED, ORPHAN_DETECTED, MANUAL_OVERRIDE action. State at decision time, not just IDs.
9. **Idempotency keys on offer submission.** Network retries must not create duplicate offers or duplicate Stripe intents.
10. **`.env*` files are never committed.** A `.env.example` lives in the repo with all variable names and empty/dummy values.

## Current state

**Weeks 1–6 complete and deployed; the full beta feature set is now shipped.** PRs #1–#98 merged. Production lives at `auckets-olive.vercel.app`. The **real Stripe money path is live** (manual-capture PaymentIntent on offer submit + binding allocation that captures placed / releases unplaced) and the **entire fan attend-path is live** end-to-end. The dev stub remains only as a no-Stripe fallback; production refuses it.

**Where we stand (2026-05-31):** Essentially **beta-ready**. A fan can put a real card down → get ranked → be seated by the GAE → have funds captured on placement → receive a geo-gated rotating-QR ticket → get scanned in at the door. Every hard and strong blocker is closed (attend-path #68–#82, payment hardening #77–#80, scheduled binding #78, displacement engine #72–#76, fan emails #90, ShowCreate + inline venue #86/#89, AllocationFinal #96). What's left for beta is **ops + one product decision**, not code — see [`REMAINING_WORK.md`](REMAINING_WORK.md).

### Shipped (read-side, bid flow, AND the real money path)

**Foundation, schema, engine:**
- Next 14, Drizzle, Clerk 6, Inngest, Sentry (dormant), Resend (dormant), Zod, pino, Tailwind, Vitest, Playwright
- CI: typecheck + lint + ~518 unit tests + build on every PR. A separate `integration` job stands up a Postgres 17 service container and runs `npm run test:integration` against it (~11 suites) for the repository-layer suites that need real SQL semantics.
- `src/lib/env.ts` Zod-validated; `ALLOW_DEV_OFFER_STUB` refused on `VERCEL_ENV=production`
- 19 Drizzle tables; migrations applied via Supabase MCP (incl. `offer_revisions`, `holds`, `stripe_webhook_events`, `displacement_events`, `offer_idempotency_keys`, and the Stripe columns on `offers`)
- RLS enabled deny-all on every public table; new tables enable RLS in their migration
- **GAE is complete:** types, rank-key, launchpad, fit-resolver, placement, waterfall, `allocate()` entry point. All tested.

**Payments (real Stripe path — live):**
- Stripe SDK + `src/lib/stripe/` client, `customers.ts` (ensure/attach Customer), `payment-intents.ts` (create/cancel manual-capture intents). Tested.
- `POST /api/offers` real path: ensures a Stripe Customer, creates a `PaymentIntent` with `capture_method:"manual"` to hold the card auth for the ≤6-day window (ADR-0003 working assumption). Stripe Elements card collection wired into OfferComposer.
- Revision support: revising an offer cancels the prior PaymentIntent (releases old auth) and creates a new one for the revised amount.
- **Binding allocation** (`src/lib/allocation/run-binding.ts`): `mode=binding` on the allocate route captures placed offers' PaymentIntents, cancels auths for unplaced offers, transitions statuses. Driven by an admin-only "Run binding" button on ShowAdmin.
- **Money path hardening (shipped #77–#80):** signed, idempotent Stripe webhook at `/api/stripe/webhook` (`stripe_webhook_events` receipts); `payment_intent.payment_failed` → card-failure recovery (backend `recoverCardFailure` + fan banner/modal + 4h-window cron); scheduled binding (`scheduled-binding` Inngest cron sweeps shows past `binding_allocation_at`). The manual admin "Run binding" button remains as a fallback. **Remaining money-path gap:** no app-level offer-idempotency-table writes yet.

**Fan UI (`/dashboard`, `/shows/[id]`, `/my-bids`):**
- Dashboard: open shows with countdowns, status badges, your-offer chips
- Show detail: prototype-fidelity offer composer (stepper, price, tier radios, auto-bid toggle) + RankBoard + PreviewBanner/VenuePreview right column; ShowAdmin wrapped in a tabbed shell
- Offer submit via the **real Stripe path** (`POST /api/offers`) with Stripe Elements card collection; dev stub remains only as the no-Stripe fallback
- /my-bids: every bid the user ever placed, reverse-chrono, with an expandable revision history derived from the `offer_revisions` table

**Artist UI (`/artists/[id]`, `/artists/[id]/shows/[id]`):**
- ArtistDashboard: snapshot stats (offers in pool, tickets in pool, median, top) + per-show rows with capacity bars
- ShowAdmin: header with city/venue/date + binding countdown banner, "Request action" button (ADR-0013), "Preview allocation" button (admin-only)
- ShowAdmin cards: BigStats (5 cells) · Recent activity feed (offer events + GAE decisions interleaved) · Tier preference breakdown · Offer-price distribution histogram (10-bucket Greenwood progression) · Provisional placement seat map (STAGE + tier sections) · Holds & manifest (read-only)
- Preview allocation runs the GAE for real, writes seat_assignments + allocation_logs, refreshes the page

**Backend services:**
- `POST /api/artist-requests` (+ `/[id]`) — file/execute pause/end-early/comp/override per ADR-0013
- `POST /api/shows/[id]/allocate` — admin-only, `mode=preview` (non-binding) and `mode=binding` (one-shot, captures/releases)
- `POST /api/offers` — real Stripe-backed offer submission/revision (dev stub is fallback only)
- `POST /api/shows` — create a show (backend only; no ShowCreate UI yet)
- `POST`/`DELETE /api/holds` — add/remove venue & artist holds
- `GET /api/artists/[id]/shows` + `/stats` — artist read APIs

**Admin / nav:**
- Role-aware site nav (fan / artist / admin / venue-staff)
- `/admin` command-center shows list (spine) + `/admin/requests` inbox
- `/admin/staff` VENUE_STAFF role management (#87)

**Attend-path, hardening, and notifications (shipped #68–#98):**
- **Tickets:** T-48h issuance cron mints a ticket + server-only `totp_secret` per paid seat of a bound show; geo-gated 60s rotating-QR `TicketViewer` + server-signed `/api/tickets/[id]/token` endpoint (#68, #69, #81)
- **Scanner:** `/scan` (VENUE_STAFF / admin-gated) → `POST /api/scan` validates the rotating QR, admits the ticket, logs every scan to `ticketScans` (#82)
- **Payment hardening:** signed/idempotent Stripe webhook (#77), card-failure recovery backend + UI + 4h cron (#79, #80), scheduled binding cron (#78)
- **Displacement engine:** auto-bid honored at preview + binding, per-fan displacement alerts on the Show page (#72–#76, ADR-0018)
- **Fan lifecycle emails:** offer-received / placed / not-placed / allocation-imminent / card-failure templates + senders wired (#90) — dormant until Resend domain is verified (ops task)
- **Show & venue creation:** ShowCreate form + `POST /api/shows` + inline venue creation (#86, #89), venue-builder UX polish (#97)
- **Fan result page:** `AllocationFinal` placed/not-placed page at `/allocation/[showId]` (#96)
- **Public surfaces:** role-aware home page (#83), public `/shows` lineup (#98), mobile-responsive pass (#85)

### External services

- [x] Clerk dev app keys in `.env.local` and Vercel envs
- [x] Supabase staging in `.env.local`; production project is the same one for now
- [x] Vercel production deployed (`auckets-olive.vercel.app`); preview env has `ALLOW_DEV_OFFER_STUB=true`
- [x] GoDaddy / `auckets.com` domain owned
- [ ] Resend domain verified (`auckets.com`) — needed before real email sends
- [ ] Sentry project created — optional, can defer until first prod show
- [ ] HFC's access revoked from Stripe before any production cutover (per `SECURITY.md` #37)
- [ ] Production Supabase project (separate from staging) — Week 7
- [ ] **Twilio / SMS**: not yet installed. 10DLC registration not started.

### Big-picture state

The **read side, the full money path, and the full attend-path are all shipped**: real offer submission (Stripe manual-capture auth) → preview/binding allocation → capture-on-placement → ticket issuance → geo-gated rotating-QR viewer → door scan. Every hard and strong blocker is closed. What remains for **beta** is no longer code (full breakdown in [`REMAINING_WORK.md`](REMAINING_WORK.md)):

- **Ops, not code:** verify `auckets.com` in Resend + set `RESEND_API_KEY` in prod so the (already-built) fan emails send; revoke HFC's Stripe access; stand up a separate prod Supabase project (Week 7).
- **One open product decision:** group cost-split — needs an ADR before any build.
- **Genuinely post-beta:** resale flow (ADR-0014), Twilio/SMS (10DLC is the long pole), full VenueBuilder, Sentry DSN.

**ADR-0003 (2026-05-27):** ≤6-day offer windows + auth-based hold is still a working assumption (Julia), **pending Cope confirmation**. The money path is built against it; if Cope's research lands on windows >6 days, revisit the PaymentIntent path (see the 2026-05-27 note in `docs/DECISIONS.md` ADR-0003).

## Next session

The hard / strong / soft beta blockers are **all shipped** (#68–#98). What's left is sequenced below (full breakdown in [`REMAINING_WORK.md`](REMAINING_WORK.md)):

**1. Ops to turn beta on (no code):**
- Verify `auckets.com` in Resend + set `RESEND_API_KEY` in the Vercel prod env so the built fan emails actually send.
- Revoke HFC's Stripe access before any production cutover (SECURITY.md #37).
- Stand up a separate production Supabase project (Week 7).

**2. One product decision before build — group cost-split.** One person buys a group's tickets, then invites others to join the outing and split the cost. Touches the offer/payment model materially (single PaymentIntent + split-tracking vs. per-joiner auths) — **needs a product decision / ADR before build.** Capture as an OPEN_QUESTION first.

**3. Remaining soft polish (beta-tolerable):** Fans · data export tab on ShowAdmin (needs a privacy review first), DisplacementToast polling/push, ArtistDashboard provisional-payout cell.

**Post-beta (don't block on these):** Resale flow (ADR-0014), full VenueBuilder + atomic seating units, Twilio/SMS 10DLC (1–2 week carrier turnaround — can start registration anytime), Sentry DSN, Stripe Connect Express confirmation.

## Companion docs

Read these as needed. They go deep where this file is high-level.

- **`ARCHITECTURE.md`** — how the system fits together. Components, data flow, deployment.
- **`DECISIONS.md`** — the decision log. Why we picked what we picked.
- **`CONVENTIONS.md`** — coding standards, file layout, testing patterns, naming.
- **`GAE_SPEC.md`** — the Greenwood Allocation Engine in detail. **Critical** if you are touching `src/lib/gae/`.
- **`ROADMAP.md`** — week-by-week build plan.
- **`REMAINING_WORK.md`** — design-vs-shipped cross-walk + priority-ordered backlog. Read this before picking a slice.
- **`PERSONAS.md`** — alpha-friction audit of how fans / artists / admins navigate the shipped surfaces. Read before UX/journey work.
- **`OPEN_QUESTIONS.md`** — what is not yet decided. Things you must not assume.
- **`SECURITY.md`** — the non-negotiable rules.
- **`RUNBOOK.md`** — operational procedures.
- [`GAE_SIMULATOR.md`](GAE_SIMULATOR.md) — the simulator that runs the engine on real or described crowds: requirements, what each slice built, the Q1–Q5 numbers on Cope's data. Usage in [`sim/README.md`](../sim/README.md); in the app at `/admin/simulation`.

## Working norms

- Small, focused PRs. One concern per branch.
- Commits explain *why*, not *what*. The diff shows what.
- Tests with the code. Especially for `src/lib/gae/`.
- When in doubt, ask. Do not guess on product decisions — flag the open question.
- When you make an architectural decision, write an ADR in `docs/decisions/`.
- Update this file's "Current state" section at the end of each session.
