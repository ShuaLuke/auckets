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

**Status:** Accepted
**Date:** 2026-05-25

**Decision:** When a fan submits an offer, we create a Stripe SetupIntent to tokenize their card. We do **not** create a PaymentIntent or place a hold. When allocation runs and the offer is accepted, we create a PaymentIntent against the saved payment method and confirm immediately.

**Reasoning:** Stripe payment intents in `requires_capture` state (pre-auths/holds) expire after 7 days for most card networks. Our offer windows may exceed this — Cope wants flexibility to open offer windows weeks in advance. The alternatives are all worse:

- **Periodic re-authorization:** every 5-6 days, cancel and recreate the intent. Visible to cardholders in their banking app. Can fail. ~1 week of engineering for an annoying flow.
- **Capture immediately + refund losers:** terrible UX (fan is debited even though they may not get tickets). Disrupts cash flow.
- **Short offer windows only:** sacrifices product flexibility for technical simplicity.

SetupIntent + charge on acceptance is the standard modern ticketing pattern. The tradeoff is that ~2% of charges fail at allocation time (expired cards, insufficient funds), and we need a "card declined, please update" flow. This is acceptable and expected.

**Alternatives:** see above.

**Consequences:** We need a payment-failure handling flow. We need a grace window (proposed: 24 hours) for fans whose cards fail to update payment and reclaim their seats before they go back to the pool.

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
