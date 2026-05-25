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

**Week 1 (Foundation) — complete in code, partial on external services.**

Code (PRs #1–#8, all merged):
- [x] Tech stack and architecture decided
- [x] Open questions documented (see `OPEN_QUESTIONS.md`)
- [x] Repo and CI set up (GitHub Actions: typecheck + lint + test + build on every PR)
- [x] Foundation packages installed (Next 14.2.35, Drizzle, Clerk 6.x, Inngest, Sentry, Resend, Zod, pino, Tailwind, Vitest, Playwright)
- [x] Clerk wired (sign-in / sign-up / `/dashboard` protected route)
- [x] Sentry wired (dormant without DSN)
- [x] Pino logger with secret-field redactions
- [x] Inngest serve handler at `/api/inngest` + one no-op `hello-world` function
- [x] Resend client (dormant without API key) + placeholder welcome template
- [x] Vitest + first real unit tests (`src/lib/money.ts`, 10 passing)
- [x] Playwright + one trivial smoke (real app smoke deferred to when CI env can host Clerk)
- [x] `src/lib/env.ts` Zod-validated, with prod guard refusing `SKIP_ENV_VALIDATION`

External services — set up as keys become available:
- [x] Clerk dev application created, keys live in `.env.local`
- [x] Supabase staging project created, connection string in `.env.local`
- [x] Stripe account access confirmed (not yet wired in code)
- [x] GoDaddy / `auckets.com` domain owned
- [ ] Resend domain verified (`auckets.com`) — needed before real email sends
- [ ] Sentry project created — optional, can defer until first prod show
- [ ] HFC's access revoked from Stripe before any production cutover (per `SECURITY.md` #37)
- [ ] Production Supabase project (separate from staging) — Week 7
- [ ] Production Vercel deployment — Week 7

Still ahead:
- [ ] Initial schema written (Week 3)
- [ ] GAE spike (pure logic, no DB) — **next priority, Week 2**
- [ ] Venue architecture builder (Week 3)
- [ ] Offer submission flow (Week 4)
- [ ] Allocation API endpoint (Week 5)
- [ ] Stripe SetupIntent + charge-on-acceptance (Week 5)
- [ ] Notification system (Weeks 4–5)
- [ ] Artist dashboard (Week 6)
- [ ] Fan-facing UI polish (Weeks 8+)
- [ ] First beta show (Week 8)

## Next session

**Working on:** Week 2 — the GAE spike. Pure logic, lives in `src/lib/gae/`, no DB / HTTP / Stripe / filesystem. See `GAE_SPEC.md` for the full spec and `ROADMAP.md` Week 2 for the sequenced checklist.

Suggested first slice: define all GAE types in `src/lib/gae/types.ts`, then implement `rankkey.ts` with co-located unit tests. Each subsequent module (`launchpad.ts`, `fitresolver.ts`, `placement.ts`, `waterfall.ts`) is its own slice.

**Lincoln Theatre data:** the spec's headline integration test waits on Cope sending real venue + offer data. Don't block the GAE on it — build against synthetic data first, swap in Lincoln Theatre as a fixture when it arrives.

**Do not start on:**
- The offer submission flow (waits on Q12 — fan offer revisability)
- Stripe payment integration (waits on NEW-1; default SetupIntent is fine)
- The artist dashboard (waits on Q28/29/30)
- The fan-facing UI (last)

**Operational follow-ups any time:**
- Verify `auckets.com` in Resend so real emails can send
- Create a Sentry project + paste DSN into Vercel envs (when we have a Vercel deploy)
- Set up Vercel project (no rush — pre-production)
- Enable GitHub branch protection on `main` requiring the CI check

## Companion docs

Read these as needed. They go deep where this file is high-level.

- **`ARCHITECTURE.md`** — how the system fits together. Components, data flow, deployment.
- **`DECISIONS.md`** — the decision log. Why we picked what we picked.
- **`CONVENTIONS.md`** — coding standards, file layout, testing patterns, naming.
- **`GAE_SPEC.md`** — the Greenwood Allocation Engine in detail. **Critical** if you are touching `src/lib/gae/`.
- **`ROADMAP.md`** — week-by-week build plan.
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
