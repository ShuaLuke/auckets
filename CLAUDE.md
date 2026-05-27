# Notes for Claude

Orientation for a new Claude Code session. Read this first, then [`docs/CONTEXT.md`](docs/CONTEXT.md), then [`docs/REMAINING_WORK.md`](docs/REMAINING_WORK.md) to see what's shipped vs what's left and pick a slice, then check `git log --oneline -20` for the latest movement.

---

## What this project is, in one sentence

AUCKETS is a Next.js 14 + TypeScript + Postgres app that runs a fairness-first allocation engine (the GAE) to seat live-music fans by their submitted offers, instead of running a per-ticket auction.

The long version: [`docs/CONTEXT.md`](docs/CONTEXT.md).

---

## How we work

1. **Slices, not features.** Each PR is one focused concern, named like `feat/slice-N-...` or `chore/slice-N-...` or `docs/slice-N-...`. Branch off `main`, open a PR, wait for review, merge, delete branch, sync `main`, start the next slice. See past PRs for the cadence.
2. **Commits explain *why*.** The diff shows *what*. Long-form commit messages are the norm here — they're how we communicate intent to the next reader, including future-us.
3. **Tests with code.** Vitest for unit (co-located, `foo.test.ts` next to `foo.ts`). Playwright for e2e (in `tests/e2e/`). The GAE has stricter standards (see [`docs/GAE_SPEC.md`](docs/GAE_SPEC.md)).
4. **Ask before assuming on product questions.** [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) catalogues what's not yet decided. Don't guess past a "working assumption" without flagging it.
5. **No deploys yet.** No Vercel project exists. Production is Week 7+. Anything you build is non-load-bearing until then.

---

## Hard constraints — don't break these

From [`docs/CONTEXT.md`](docs/CONTEXT.md#prime-directives--never-violate-these) and [`docs/SECURITY.md`](docs/SECURITY.md):

- **The GAE is pure logic.** No HTTP, no DB, no Stripe, no email, no filesystem. Lives in `src/lib/gae/`. See [`docs/GAE_SPEC.md`](docs/GAE_SPEC.md).
- **Money is integer cents always.** No floats, no strings, no decimal libraries. Column names end in `_cents`. Helpers in [`src/lib/money.ts`](src/lib/money.ts).
- **All env vars go through Zod validation** in [`src/lib/env.ts`](src/lib/env.ts). Never `process.env.X` elsewhere in app code.
- **All API inputs validated with Zod.** No exceptions.
- **Auth on every route, then authorization, then business logic.** In that order.
- **Supabase publishable/anon key is a private credential.** No `NEXT_PUBLIC_SUPABASE_*` vars, no `@supabase/supabase-js` in the client. RLS is intentionally OFF ([docs/ARCHITECTURE.md §Database](docs/ARCHITECTURE.md)), so a leaked anon key = full DB read via PostgREST. App talks to Postgres only through Drizzle server-side. See [SECURITY.md rule 26](docs/SECURITY.md#database-and-data-handling).
- **Stripe webhooks verify signatures.** Every handler idempotent.
- **Bond events are append-only.**
- **Allocation decisions log full snapshot state**, not just IDs.
- **Idempotency keys on offer submission**, propagated to Stripe.
- **`.env*` never committed** (except `.env.example`).

---

## Stack — what's already in (don't reinvent)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js **14.2.35** (App Router) | Pinned to 14.x. Don't bump to 15 without an ADR — Clerk v7+ also requires it, so it's a coordinated swap. |
| Language | TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | The extra flags catch real bugs — don't disable per-file. |
| DB | Postgres via Supabase (Drizzle ORM) | Schema in `drizzle/schema.ts` is currently a placeholder. Real schema lands in Week 3. |
| Auth | Clerk `^6.39.4` | v7 needs Next 15. Sign-in/up at `/sign-in` and `/sign-up`. Protected at `/dashboard`. |
| Background jobs | Inngest | Serve at `/api/inngest`. `npm run inngest:dev` for local. |
| Email | Resend + React Email | Templates in `src/lib/email/templates/`. Client dormant without `RESEND_API_KEY`. |
| Errors | Sentry | Client + server + edge wired. Dormant without `NEXT_PUBLIC_SENTRY_DSN`. |
| Logging | pino | Secret-field redactions wired. Use `logger` from `src/lib/logger.ts`. |
| Tests | Vitest + Playwright | `npm test`, `npm run test:e2e`. |
| CI | GitHub Actions | `.github/workflows/ci.yml`. Runs typecheck + lint + test + build. |

---

## Common gotchas (the things that have already burned us)

- **Default dev port is 3001**, not 3000. Cached service workers from a previous project on the same machine claim 3000.
- **The dev server can't render pages without real Clerk keys.** ClerkProvider tries to handshake with the Clerk Frontend API at startup; dummy keys point at `clerk.example.com` and Safari/Chrome can't resolve it. Real `pk_test_` and `sk_test_` from a real Clerk dev instance are required.
- **`SKIP_ENV_VALIDATION=1` is refused when `NODE_ENV=production`.** Intentional safeguard so a stray env-var on Vercel can't defeat the validator.
- **Inngest v4 collapsed the `createFunction` signature** — triggers now live inside the options object (`{ id, triggers: [...] }`), not as a second argument. Old docs and tutorials show the three-arg form.
- **Drizzle migrations don't run yet** — no schema, no migrations. Coming in Week 3.
- **Branch off `main` AFTER the previous PR merges, not before.** Slice 8 was branched before Slice 7 merged, which produced a `.gitignore` conflict that had to be resolved. Wait for the merge.

---

## v2 product gotchas — the things that aren't obvious from CONTEXT.md alone

These are decisions from the May 25 v2 round of Cope/Julia answers. Read `docs/OPEN_QUESTIONS.md` and the new ADRs in `docs/DECISIONS.md` for the full reasoning.

- **Group cap is 10, not 8.** Working assumption changed; comment-only fix landed in `rankkey.ts`. ADR-0011.
- **Roles for MVP are `FAN` + `ARTIST` + `AUCKETS_ADMIN`** (3, not 4). `VENUE_STAFF` added Week 7 for Austin. The design system's `MANAGER` / `STAFF` are deferred indefinitely. ADR-0012.
- **Artists do NOT directly control pause / end-early.** They file a request via the dashboard; AUCKETS staff execute. Changes Week 6 dashboard scope. ADR-0013.
- **Resales refund the seller at original price.** Any uplift goes to the artist, not the seller. This is structural anti-scalping. ADR-0014.
- **Tickets are rotating QR (60s) + geo-gated.** No static printable tickets. ADR-0015.
- **SMS is at MVP, not Phase 1.5.** Adds Twilio to the foundation. 10DLC registration is the long pole (1–2 weeks of carrier turnaround). ADR-0016.
- **Auto-bid and private offers are first-class on the offer.** The offer schema carries `auto_bid_enabled`, `auto_bid_cap_cents`, `private_threshold_cents`. ADR-0017.
- **ADR-0003 (Stripe SetupIntent) is "Accepted, pending hold-window decision."** Cope is still researching whether we want offer windows >6 days. Don't ship offer submission (Week 4) until this is settled.
- **Bleacher (the design doc's "second channel") is NOT confirmed** by Cope. Don't bake `offers.channel` into the schema until he weighs in. NEW-8.

---

## Where to start a new session

1. Read this file.
2. Read [`docs/CONTEXT.md`](docs/CONTEXT.md) — especially "Current state" and "Next session" at the bottom.
3. `git log --oneline -20` and `gh pr list --state all -L 10` for recent activity.
4. If picking up a specific area, also read:
   - GAE work → [`docs/GAE_SPEC.md`](docs/GAE_SPEC.md)
   - Database work → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) + `drizzle/schema.ts`
   - Anything user-facing → [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md)
   - Local setup issues → [`docs/runbooks/local-dev.md`](docs/runbooks/local-dev.md)

---

## Who you're working with

- **Cope** (Clarence Greenwood / Citizen Cope) — artist, product owner.
- **Josh** — technical lead. Solo developer for now.
- **Julia** — admin / operations, often the one running setup tasks alongside Josh.
- **Fans** — submit offers, get seated, attend shows.

Be matter-of-fact, prefer plain English over jargon, surface options before locking in choices, never assume past an OPEN_QUESTION. Small focused PRs over big sweeping ones. Honest about tradeoffs.
