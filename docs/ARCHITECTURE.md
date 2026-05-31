# Architecture

This document explains how AUCKETS fits together: components, data flow, key abstractions, and the reasoning behind the structure. For *what* we chose (and why we didn't choose the alternatives), see `DECISIONS.md`. For *how to code* within this architecture, see `CONVENTIONS.md`.

---

## System overview

AUCKETS is a single Next.js application deployed on Vercel, talking to a Postgres database on Supabase, with three external services (Clerk for auth, Stripe for payments, Resend for email) and one job runner (Inngest). Sentry collects errors. That's the entire production system.

```
        ┌─────────────────┐
        │  Fan browser    │ ─── React (Next.js client components)
        └────────┬────────┘
                 │ HTTPS
                 ▼
        ┌─────────────────┐
        │  Next.js app    │ ─── Vercel-hosted
        │  (App Router)   │
        │                 │
        │  - Server pages │
        │  - API routes   │
        │  - GAE module   │
        └────────┬────────┘
                 │
       ┌─────────┼─────────┬──────────────┬──────────────┐
       ▼         ▼         ▼              ▼              ▼
   ┌────────┐ ┌──────┐ ┌────────┐    ┌──────────┐  ┌──────────┐
   │Supabase│ │Clerk │ │ Stripe │    │  Resend  │  │ Inngest  │
   │Postgres│ │ Auth │ │ Connect│    │  Email   │  │  Jobs    │
   └────────┘ └──────┘ └────────┘    └──────────┘  └──────────┘
                            ▲
                            │ webhooks
                            └──── verified, idempotent handlers
```

There is no separate backend service, no microservices, no event bus, no Redis. Everything that needs to run async runs in Inngest. Everything that needs to persist lives in Postgres. This is deliberate. We add complexity when we have a problem that demands it, not before.

## Layer responsibilities

### Client (React, Next.js client components)

Renders UI. Submits forms. Reads server state via server components or fetch from API routes. **Never** computes a rank, decides an allocation, or trusts a price. The client is a view layer over server truth.

### Server (Next.js App Router, route handlers, server actions)

- Validates inputs with Zod.
- Checks auth (Clerk) and authorization (role checks).
- Calls business logic in pure/orchestration modules under `src/lib/` (e.g. `src/lib/allocation/`, `src/lib/stripe/`, `src/lib/notifications/`).
- Reads/writes via Drizzle.
- Returns typed responses.

API routes are thin. They do auth + validation + delegation. They do **not** contain business logic. Business logic lives under `src/lib/` — orchestration in feature folders (`src/lib/allocation/`, `src/lib/stripe/`) and pure logic in `src/lib/gae/`. (`src/server/` was reserved for this in the original layout but went unused; the orchestration landed under `src/lib/` instead.)

### Database (Supabase Postgres)

Single source of truth. All money in cents as `integer`. JSONB for flexible structured data (venue row holds, allocation snapshots, bond event payloads). Row-level locking via `SELECT ... FOR UPDATE` when multiple offers may compete for the same seats simultaneously.

We do **not** use Supabase row-level security for application access — auth happens at the API layer with Clerk. Supabase Postgres is just our managed database; the rest of Supabase's features are unused.

### The GAE (`src/lib/gae/`)

The most important architectural decision in the entire system. The Greenwood Allocation Engine is a **pure logic module** with these properties:

- No HTTP. No database calls. No Stripe. No email. No filesystem.
- Functions take inputs, return outputs. No side effects except returning a log.
- Fully testable in isolation, with no mocks of external services needed.
- Could be extracted to a separate Rust/Go service later without changing the interface.

The shape:

```typescript
// Conceptually
function allocate(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  config: AllocationConfig
): AllocationResult {
  // Returns: seat assignments + decision log
  // Writes: nothing
}
```

The orchestration layer (`src/lib/allocation/` — `run-preview.ts`, `run-binding.ts`, `build-plan.ts`, `translate.ts`) reads the offers and venue from the database, calls `allocate()`, and writes the result back. The GAE itself is ignorant of where its data came from or where the output is going. See `GAE_SPEC.md` for the full specification.

### Background jobs (Inngest)

Anything that:
- takes more than ~3 seconds,
- must retry on failure,
- runs on a schedule, or
- fans out to many work items,

goes through Inngest. Examples:
- Running an allocation against a full venue.
- Sending bulk notification emails after allocation.
- Capturing Stripe charges after allocation.
- Refreshing Stripe pre-auths (if we ever go that route).
- Bond score recomputes (Phase 2).

Inngest gives us durability, retries, observability, and scheduling without us building any of it. Vercel's 10-second function limit on hobby (60s on pro) is the practical reason this matters — a 1,200-seat allocation could exceed that.

### Auth (Clerk)

Clerk handles fan signup/login (email + Google + Apple at MVP), session management, and webhooks for syncing users to our database. We use a `users` table keyed by Clerk's user ID, with a webhook handler that creates/updates that record on Clerk events.

Roles are stored in our database, not in Clerk — Clerk knows who you are; our app knows what you can do. MVP roles are `FAN`, `ARTIST`, `AUCKETS_ADMIN`, and `VENUE_STAFF` (ADR-0012); the design system's `MANAGER`/`STAFF` are deferred indefinitely.

### Payments (Stripe Connect)

Artists are merchants. Each artist gets a Stripe Connect Express account. Charges are made on behalf of the artist; AUCKETS takes an application fee (configurable, defaulting to 0% until the business model is set).

Payment flow (**as shipped**, per the ADR-0003 working assumption — ≤6-day windows + auth-based hold):

1. Fan submits offer. We ensure a Stripe **Customer** and create a manual-capture **PaymentIntent** (`capture_method: "manual"`) that holds the card auth for the offer's full amount. Revising cancels the prior intent and recreates it.
2. Offer sits ranked in the pool; the auth holds within Stripe's ~7-day reliable-auth window.
3. Binding allocation runs. Placed offers get their PaymentIntent **captured**; unplaced offers get the auth **cancelled** (funds released).
4. ~2% capture-failures (expired card, NSF). The signed/idempotent webhook (`/api/stripe/webhook`) flags `card_failure`; the fan gets a 4h recovery window (banner + Elements modal + email) to retry with a new card.

This is the **≤6-day pre-auth (manual-capture PaymentIntent)** model. The original **SetupIntent + charge on acceptance** design (see `DECISIONS.md` ADR-0003) is the documented fallback if Cope's research lands on windows >6 days. `transfer_data` to artist Connect accounts is wired where the business model dictates.

### Email (Resend + React Email)

Templates are React components in `src/lib/email/templates/`. Resend sends them. Domain is `auckets.com` (already owned). We are AUCKETS-branded at MVP with the artist's name prominent in the body — per-artist sender domains are Phase 2.

### Error tracking (Sentry) and logging (pino)

Every uncaught error goes to Sentry. Every meaningful event (auth attempt, offer submission, allocation start/end, payment, webhook received) gets a structured log line via pino. Logs are JSON, aggregated by Axiom or Better Stack (decide before launch — both are fine).

## Data flow: the offer lifecycle

The single most important sequence in the system. Walk through it slowly the first time you read this.

> **Note (2026-05-31):** the sequence below was written against the original SetupIntent design and the PENDING/ACCEPTED/OUTBID/WAITLISTED status vocabulary. As shipped, step 2 creates a manual-capture **PaymentIntent** (not a SetupIntent), step 4 **captures placed / cancels unplaced** auths, statuses use the `placed`/`unplaced`/`card_failure` vocabulary, and `BOND_EVENT` is deferred to Phase 2 (`bond_events` not yet shipped). The shape is otherwise accurate. See the "Payments" section above and ADR-0003 for the real path.

```
1. Fan visits show page.
   - Server reads show, sections, current offer-pool stats.
   - Renders price ranges, current rank distribution (aggregate only).

2. Fan submits offer (group size, price/ticket, tier preference).
   - API route: validate with Zod.
   - API route: check auth (Clerk).
   - API route: check idempotency key.
   - Server: create Stripe SetupIntent for the fan's card.
   - Server: insert offer with status=PENDING, computed rank_key.
   - Server: append BOND_EVENT (event_type=OFFER_SUBMITTED).
   - Server: return offer + SetupIntent client secret.
   - Client: confirms SetupIntent with Stripe.js, captures payment method.

3. (Continuous) Preview allocation runs.
   - Inngest scheduled job (every N minutes, debounced).
   - Reads venue + all PENDING offers.
   - Calls GAE.allocate() in preview mode (writes nothing binding).
   - Stores preview result, exposes "your projected rank" to each fan.

4. Binding checkpoint (24h before door, then at door time).
   - Inngest scheduled job.
   - Reads venue + all PENDING offers.
   - Calls GAE.allocate() in binding mode.
   - For each ACCEPTED offer:
     - Create PaymentIntent against the saved SetupIntent.
     - On success: status=ACCEPTED, assign seats, append BOND_EVENT, send email.
     - On failure: status=PAYMENT_FAILED, notify fan with retry window.
   - For each OUTBID offer:
     - status=OUTBID, send email.
   - For each WAITLISTED offer:
     - status=WAITLISTED, send email.
   - All decisions logged to allocation_logs.

5. Show happens. Attendance recorded.
   - BOND_EVENT appended (event_type=SHOW_ATTENDED).
```

Every step is observable, reversible (within payment-already-captured constraints), and auditable.

## Data flow: the GAE call

Inside step 4 above, the GAE itself looks like:

```
Input:
  - VenueArchitecture { rows: [...], activeSectionIds: [...] }
  - RankedOffer[] (sorted by rank_key descending)
  - AllocationConfig { allowOrphans: false, maxGroupSize: 8, ... }

Process:
  1. RankKey: confirm offers are sorted; tiebreak by submission time.
  2. For each row in venue (best to worst):
     a. Skip if not in active sections.
     b. Compute available capacity (capacity - holds).
     c. LaunchPad: find the optimal combination of remaining ranked offers
        that fills this row without splitting groups or creating orphans,
        respecting rank order and tier preferences.
     d. FitResolver: if the next ranked offer doesn't fit, scan down the
        ranked list for the best offer that does fit, while keeping skipped
        offers available for the next row.
     e. Placement: place the chosen groups within the row according to row
        lean (CENTER, LEFT, RIGHT, DUAL_AISLE).
     f. Log each decision (PLACED, SKIPPED, FIT_RESOLVED, ORPHAN_DETECTED).
  3. Waterfall: any offer not placed in its preferred tier gets considered
     for lower tiers per the fan's tier preference.

Output:
  - AllocationResult { assignments: [...], decisions: [...], unplaced: [...] }
```

See `GAE_SPEC.md` for the full spec, including edge cases, pathological inputs, and tests.

## Environments

| Environment | Hosting | Database | Stripe | Use |
|---|---|---|---|---|
| Local | `localhost:3001` | Local Supabase or dedicated dev project | Stripe test keys | Day-to-day dev |
| Staging | Vercel preview or dedicated staging URL | Supabase staging project | Stripe test keys | Pre-prod testing, dress rehearsals |
| Production | Vercel production | Supabase production project | Stripe live keys | Real shows |

**Never mix.** Production keys never appear outside production. Each environment has its own Clerk instance, Stripe account configuration, Resend domain, and Sentry project.

## Deployment

`main` branch deploys to production via Vercel. PR branches deploy to preview URLs automatically. Database migrations run via `drizzle-kit` in a CI step before deploy, against the matching environment's database.

**There is no manual database access in production.** All schema changes are migrations checked into the repo. If you need to fix data in production, write a script in `scripts/`, get it reviewed, and run it via a controlled job — not by hand in `psql`.

## Observability

- **Sentry** captures uncaught exceptions in the Next.js app and in Inngest handlers.
- **Pino logs** stream to Axiom or Better Stack (TBD before launch).
- **Stripe dashboard** is the source of truth for payment health.
- **Inngest dashboard** shows job runs, retries, and failures.
- **Supabase dashboard** shows DB performance and connection counts.

For show day, we want a single internal dashboard showing: current offer count, allocation status, payment capture success rate, email send success rate, and active error count. This is a Phase 1.5 build — not blocking MVP but required before any show with more than ~100 attendees.

## What we are explicitly NOT doing

To preempt scope creep, these are out of scope for MVP:

- Multi-region deployment
- Mobile native apps (Next.js PWA is enough)
- Real-time WebSocket connections (polling is fine at our scale)
- A separate analytics database (read replicas suffice)
- Service mesh, Kubernetes, custom infrastructure
- Custom auth (Clerk is fine)
- Custom payments infra (Stripe is fine)
- A queueing system beyond Inngest
- Server-side rendering optimization beyond Next.js defaults

If a future requirement pushes against this list, we revisit it deliberately in an ADR. Not by accident.
