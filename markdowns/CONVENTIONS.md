# Conventions

How we write code in AUCKETS. This document is prescriptive — when a question comes up that's covered here, use this answer. If you disagree with something here, write an ADR proposing the change rather than just deviating.

---

## TypeScript

- **Strict mode is on.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are both true. Don't disable them per-file.
- **Prefer `type` over `interface`** unless you specifically need declaration merging.
- **Never use `any`.** Use `unknown` and narrow. If you genuinely need `any`, comment why.
- **No `as` casts** without a comment explaining why the cast is sound. Type assertions are admitting the type system can't verify what you know to be true; that deserves explanation.
- **Discriminated unions for state.** `type Offer = { status: 'pending', ... } | { status: 'accepted', acceptedAt: Date, ... }` rather than nullable fields.

## File layout and naming

```
src/lib/gae/launchpad.ts        kebab-case for files
src/lib/gae/types.ts            shared types per module live in types.ts
src/components/OfferCard.tsx    PascalCase for React components
src/app/api/offers/route.ts     Next.js convention for API routes
```

- One responsibility per file. If a file is over ~300 lines, look hard at whether it should be split.
- Co-locate tests with code: `launchpad.ts` and `launchpad.test.ts` in the same directory.
- Shared types for a module go in `types.ts` at the module root.

## Imports

- Use absolute imports rooted at `src/`. Configure `paths` in `tsconfig.json` so `import { db } from '@/lib/db'` works.
- Group imports: (1) Node/external packages, (2) internal modules from `@/`, (3) relative imports, (4) types.
- Prefer named exports. Default exports only when the framework requires (Next.js page components, route handlers).

## Naming

- **Functions:** verbs. `allocateRow`, `validateOffer`, `chargePaymentIntent`.
- **Booleans:** `is`, `has`, `can` prefix. `isOrphan`, `hasSplit`, `canBePlaced`.
- **Database tables:** snake_case, plural. `offers`, `venue_rows`, `allocation_logs`.
- **Database columns:** snake_case. `price_per_ticket_cents`, `rank_key`.
- **TypeScript types/interfaces:** PascalCase singular. `Offer`, `VenueRow`, `AllocationResult`.
- **Constants:** SCREAMING_SNAKE_CASE for module-level constants. `MAX_GROUP_SIZE`, `DEFAULT_OFFER_WINDOW_DAYS`.
- **Enums:** Use string literal unions or `as const` objects, not TypeScript `enum` (enum has bad runtime semantics).

## Money

Always integer cents. Never floats. Helpers in `src/lib/money.ts`:

```typescript
formatCents(4250)       // "$42.50"
parseDollars("$42.50")  // 4250
addCents(100, 250)      // 350 — but just use `+`
```

Column names that hold money end in `_cents`. Always. `price_per_ticket_cents`, `floor_price_cents`, `application_fee_cents`. No exceptions.

## Database access

- **All DB access via Drizzle.** No raw `pg` clients elsewhere.
- **One Drizzle client.** Singleton in `src/lib/db/index.ts`. Import from there.
- **Transactions** for any operation that writes to more than one table or needs locking. `db.transaction(async (tx) => { ... })`.
- **`SELECT FOR UPDATE`** when multiple concurrent requests may race on the same row. This is the primary tool for offer submission and allocation correctness.
- **Schema is the source of truth.** Don't write migrations by hand; let `drizzle-kit generate` do it from `drizzle/schema.ts`.

## API routes

Every route handler follows this structure:

```typescript
// src/app/api/offers/route.ts
import { auth } from '@/lib/auth';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const SubmitOfferSchema = z.object({
  showId: z.string().uuid(),
  groupSize: z.number().int().min(1).max(8),
  pricePerTicketCents: z.number().int().min(1),
});

export async function POST(req: Request) {
  // 1. Authn
  const session = await auth();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // 2. Parse + validate
  const body = SubmitOfferSchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: body.error.issues }, { status: 400 });

  // 3. Idempotency check (if applicable)
  const idempotencyKey = req.headers.get('idempotency-key');
  // ... check and short-circuit if duplicate

  // 4. Authz
  // ... verify the user can submit an offer to this show

  // 5. Delegate to business logic
  try {
    const result = await submitOffer({ userId: session.userId, ...body.data, idempotencyKey });
    return Response.json(result);
  } catch (err) {
    logger.error({ err, userId: session.userId }, 'offer submission failed');
    return Response.json({ error: 'internal' }, { status: 500 });
  }
}
```

API routes are thin. They do auth, validation, idempotency, and delegate. Business logic lives in `src/server/`.

## The GAE module — special rules

`src/lib/gae/` has stricter rules than the rest of the code:

- **No external imports** except `zod` (for input validation at the GAE boundary) and pure utilities. Specifically, no `db`, no `stripe`, no `clerk`, no `fetch`, no `fs`, no `process.env`.
- **All functions are pure.** Given the same input, they return the same output. No exceptions.
- **All state is passed in as arguments.** No module-level mutable state.
- **Exhaustive tests.** Every public function has tests covering clean cases, edge cases, and pathological inputs. See `GAE_SPEC.md` for the canonical test list.
- **No `Date.now()` or `Math.random()` directly.** If you need them, accept a clock or RNG as a function argument so tests can inject deterministic values.

The reason for all this is that the GAE is the heart of the product. If it's wrong, nothing else matters. If it's right, everything else is bookkeeping. Treat it accordingly.

## Error handling

- **Throw on programmer errors** (bugs, invariant violations). These should crash loudly and end up in Sentry.
- **Return Result-like types for expected failures** (validation failures, business rule violations, "card was declined"). These are not exceptions; they are part of normal flow.

```typescript
type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

The convention: external boundaries (API routes, webhook handlers) catch exceptions and convert to HTTP responses. Internal code uses Result for expected failures and throws for unexpected ones.

## Logging

- **Use the pino logger.** `import { logger } from '@/lib/logger'`. Don't use `console.log` in committed code.
- **Structured fields, not formatted strings.** `logger.info({ offerId, userId }, 'offer submitted')`, not `logger.info(\`offer \${offerId} submitted by \${userId}\`)`.
- **Levels:** `error` for things that need attention, `warn` for unexpected-but-handled, `info` for important events (auth, submission, allocation start/end, payment), `debug` for development.
- **Never log secrets.** API keys, passwords, full card numbers, full Stripe customer secrets. Sentry has scrubbing; we don't rely on it.

## Tests

- **Unit tests in `tests/unit/`** for pure logic (especially the GAE). Vitest.
- **Integration tests in `tests/integration/`** for code that touches the database. These spin up a test database; never run against staging or prod.
- **E2E tests in `tests/e2e/`** for the critical user flows. Playwright. The flows we care about: fan signs up and submits offer; artist creates show; allocation runs and emails go out; payment captures.

A PR doesn't merge without at least the relevant tests added or updated. The GAE has stricter standards: any change to a GAE module requires tests demonstrating the new behavior.

## Git

- **Branch names:** `<type>/<short-description>`. Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`. Example: `feat/gae-fitresolver`.
- **Commit messages:** explain *why*, not what. The diff shows what. "Add idempotency key to offer submission to prevent duplicate intents on mobile network retries" — good. "Update route.ts" — useless.
- **One concern per PR.** If you find yourself writing "and also" in the PR description, split it.
- **`main` is protected.** Required: passing CI, one approving review (or self-merge for solo phase with PR description anyway). Never force-push.

## Environment variables

- **All env vars are typed.** Add to `src/lib/env.ts` Zod schema, never read `process.env.X` directly elsewhere.
- **Public vs server.** `NEXT_PUBLIC_*` are shipped to the client. Everything else is server-only. Never accidentally expose a server secret with the `NEXT_PUBLIC_` prefix.
- **`.env.example` is committed** with all variable names and empty/dummy values. `.env.local` is gitignored.

## Comments

Comments explain *why*, not *what*. The code already shows what it does. A comment is for context that isn't visible in the code: a non-obvious constraint, a workaround for a bug in a dependency, a reference to a design decision.

```typescript
// Good:
// Stripe SetupIntents must be confirmed within 24h of creation per their docs;
// we cancel and recreate if the offer is still pending after 23h.
const TOKEN_REFRESH_WINDOW = 23 * 60 * 60 * 1000;

// Bad:
// Set the refresh window to 23 hours
const TOKEN_REFRESH_WINDOW = 23 * 60 * 60 * 1000;
```

`TODO` and `FIXME` comments must include a name and a reason. `// TODO: add waitlist support once we know if we want it (NEW-2)` is fine. `// TODO: fix this` is not.

## React components

- **Server components by default.** Add `"use client"` only when you need interactivity, browser APIs, or React hooks like `useState`/`useEffect`.
- **Props are typed.** Every component has a `Props` type defined nearby.
- **No prop drilling more than 2 levels.** Use composition or context.
- **Tailwind for styles.** No CSS-in-JS, no separate `.module.css` files except for unusual cases.

## Things to avoid

- **Magic numbers.** Define constants with names. `const MAX_GROUP_SIZE = 8` not `if (groupSize > 8)` scattered through the code.
- **Side effects in render.** Server components fetch; client components use effects with care. Never write to the database during render.
- **Long parameter lists.** If a function takes more than 4 parameters, wrap them in an object.
- **Premature abstraction.** If you're abstracting something for the second use site, fine. For the first, no — write it concrete, refactor when patterns emerge.
- **Code that's "obviously" temporary.** "I'll come back to this" almost always means it ships as-is. If it's worth doing, do it now or leave a `TODO` with a clear trigger for revisiting.
