# AUCKETS

Dynamic ticket allocation marketplace for live music. Fans submit offers (group size + price per ticket); the **Greenwood Allocation Engine** (GAE) ranks all offers and places groups intelligently across the venue.

> **Start here:** [`docs/CONTEXT.md`](docs/CONTEXT.md) is the source of truth for what AUCKETS is, what we're building, and what to do next. Read it at the start of every session before writing code.

## Documentation

| Doc | What's in it |
|---|---|
| [`docs/CONTEXT.md`](docs/CONTEXT.md) | What AUCKETS is, tech stack, prime directives, current state. **Read first.** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the system fits together. Components, data flow, deployment. |
| [`docs/GAE_SPEC.md`](docs/GAE_SPEC.md) | The Greenwood Allocation Engine in detail. Critical if you're touching `src/lib/gae/`. |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Coding standards, file layout, testing patterns, naming. |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | The decision log. Why we picked what we picked. New ADRs go in [`docs/decisions/`](docs/decisions/). |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Week-by-week build plan. |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | What is not yet decided. Don't assume past these. |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Non-negotiable rules. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Operational procedures. Individual runbooks live in [`docs/runbooks/`](docs/runbooks/). |

## Setup

> The Next.js app, dependencies, and tooling are not yet scaffolded. See `docs/ROADMAP.md` "Week 1 — Foundation" for the in-progress checklist. This section will fill in as the scaffold lands.

```bash
git clone https://github.com/ShuaLuke/auckets.git
cd auckets
# More to come.
```

## Tech stack

Next.js 14 (App Router) · TypeScript (strict) · PostgreSQL via Supabase · Drizzle · Clerk · Stripe Connect · Resend · Inngest · Vercel · Sentry · Tailwind · Zod · pino · Vitest · Playwright.

See [`docs/CONTEXT.md`](docs/CONTEXT.md#tech-stack-locked-in) for the locked-in choices. Don't swap one without writing an ADR.

## Working norms

- Small, focused PRs. One concern per branch.
- Commits explain *why*, not *what*.
- Tests with the code. Especially for `src/lib/gae/`.
- Architectural decisions go in [`docs/decisions/`](docs/decisions/) as a new ADR.
- Update [`docs/CONTEXT.md`](docs/CONTEXT.md) "Current state" at the end of each session.
