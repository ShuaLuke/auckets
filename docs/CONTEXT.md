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

**Weeks 1–5 — complete and deployed.** PRs #1–#50 merged. Production lives at `auckets-olive.vercel.app`. Preview deploys exercise the dev-stub offer flow end-to-end; production correctly refuses the stub (pending the real Stripe path, see below).

### Shipped (read-side and bid flow)

**Foundation, schema, engine:**
- Next 14, Drizzle, Clerk 6, Inngest, Sentry (dormant), Resend (dormant), Zod, pino, Tailwind, Vitest, Playwright
- CI: typecheck + lint + ~392 unit tests + build on every PR. A separate `integration` job stands up a Postgres 17 service container and runs `npm run test:integration` against it for the repository-layer suites that need real SQL semantics.
- `src/lib/env.ts` Zod-validated; `ALLOW_DEV_OFFER_STUB` refused on `VERCEL_ENV=production`
- 17 Drizzle tables; two migrations applied this week (`offer_revisions`, `holds`) via Supabase MCP
- RLS enabled deny-all on every public table; new tables enable RLS in their migration
- **GAE is complete:** types, rank-key, launchpad, fit-resolver, placement, waterfall, `allocate()` entry point. All tested.

**Fan UI (`/dashboard`, `/shows/[id]`, `/my-bids`):**
- Dashboard: open shows with countdowns, status badges, your-offer chips
- Show detail: prototype-fidelity offer composer (stepper, price, tier radios, auto-bid toggle)
- Offer submit via dev stub (`POST /api/offers`, ADR-0003 still pending for real Stripe path)
- /my-bids: every bid the user ever placed, reverse-chrono, with an expandable revision history derived from the `offer_revisions` table

**Artist UI (`/artists/[id]`, `/artists/[id]/shows/[id]`):**
- ArtistDashboard: snapshot stats (offers in pool, tickets in pool, median, top) + per-show rows with capacity bars
- ShowAdmin: header with city/venue/date + binding countdown banner, "Request action" button (ADR-0013), "Preview allocation" button (admin-only)
- ShowAdmin cards: BigStats (5 cells) · Recent activity feed (offer events + GAE decisions interleaved) · Tier preference breakdown · Offer-price distribution histogram (10-bucket Greenwood progression) · Provisional placement seat map (STAGE + tier sections) · Holds & manifest (read-only)
- Preview allocation runs the GAE for real, writes seat_assignments + allocation_logs, refreshes the page

**Backend services:**
- `POST /api/artist-requests` — file pause/end-early/comp/override per ADR-0013
- `POST /api/shows/[id]/allocate` — admin-only preview allocation
- `POST /api/offers` — dev-stub offer submission gated by `ALLOW_DEV_OFFER_STUB`
- `GET /api/artists/[id]/shows` + `/stats` — artist read APIs

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

Roughly **25–30% of the prototype is shipped, all on the read side and bid-submit dev-stub flow.** Everything that touches money, real ticket delivery, scanning, resales, or notifications is unbuilt. See [`REMAINING_WORK.md`](REMAINING_WORK.md) for the full cross-walk.

The dominant blocker is **ADR-0003 (Stripe SetupIntent hold-window)** — pending Cope's research. Until it settles, real money cannot flow, and the entire downstream chain (binding allocation → real tickets → scanner → card-failure recovery → resale) is blocked behind it.

## Next session

**Pick from [`REMAINING_WORK.md`](REMAINING_WORK.md).** The short list (in roughly the priority order they make sense to ship):

**Unblocked admin/artist polish — small slices, no external dependencies:**
1. **Admin inbox UI** for ops to execute / deny `artist_requests` (the filing side already ships; the execute side is open)
2. **Add hold dialog** + DELETE — currently HoldsCard is read-only
3. **Revision diffs in the activity feed** ("$30 → $40" — presenter ready, needs wiring)
4. **Fans · data export tab** — needs a privacy review first (private offer fields, per ADR-0017)

**Blocked operationally — start whenever the external work clears:**
5. **Notifications wiring** (Resend templates + Slack #ops) — once domain is verified and a Slack webhook URL is available
6. **Twilio + SMS** — long pole because of 10DLC carrier registration (1–2 weeks); start the registration anytime
7. **ShowCreate + VenueBuilder** — artist self-service for shows/venues. Today these are seeded by SQL

**Blocked on Cope's Stripe research (ADR-0003):**
8. **Real `POST /api/offers`** with SetupIntent (replaces the dev stub)
9. **Binding allocation job** — converts a preview into a real charge + ticket issuance
10. **TicketViewer** (rotating geo-gated QR per ADR-0015)
11. **Scanner** (paired with TicketViewer)
12. **CardFailure recovery** flow
13. **Resale flow** (refund seller at original; uplift to artist per ADR-0014)
14. **AllocationFinal** — fan-facing "placed / not placed" result page after binding

**Operational follow-ups any time:**
- Verify `auckets.com` in Resend so real emails can send
- **Start 10DLC SMS registration with Twilio** (1–2 week carrier turnaround)
- Create a Sentry project + paste DSN into Vercel envs
- Confirm Stripe Connect Express setup on the AUCKETS Stripe account (per Q3)

## Companion docs

Read these as needed. They go deep where this file is high-level.

- **`ARCHITECTURE.md`** — how the system fits together. Components, data flow, deployment.
- **`DECISIONS.md`** — the decision log. Why we picked what we picked.
- **`CONVENTIONS.md`** — coding standards, file layout, testing patterns, naming.
- **`GAE_SPEC.md`** — the Greenwood Allocation Engine in detail. **Critical** if you are touching `src/lib/gae/`.
- **`ROADMAP.md`** — week-by-week build plan.
- **`REMAINING_WORK.md`** — design-vs-shipped cross-walk + priority-ordered backlog. Read this before picking a slice.
- **`OPEN_QUESTIONS.md`** — what is not yet decided. Things you must not assume.
- **`SECURITY.md`** — the non-negotiable rules.
- **`RUNBOOK.md`** — operational procedures.

## Working norms

- Small, focused PRs. One concern per branch.
- Commits explain *why*, not *what*. The diff shows what.
- Tests with the code. Especially for `src/lib/gae/`.
- When in doubt, ask. Do not guess on product decisions — flag the open question.
- When you make an architectural decision, write an ADR in `docs/decisions/`.
- Update this file's "Current state" section at the end of each session.
