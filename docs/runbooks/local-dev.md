# Local dev setup

How to get AUCKETS running on your laptop. Companion to the higher-level commands in [`docs/RUNBOOK.md`](../RUNBOOK.md).

---

## One-time

### 1. Clone and install

```bash
git clone https://github.com/ShuaLuke/auckets.git
cd auckets
npm install
```

### 2. Create `.env.local`

```bash
cp .env.example .env.local
```

Then fill in real values from the dashboards below. **Do not commit** — `.env.local` is gitignored.

### 3. Get keys from each service

| Variable | Where to get it | Required? |
|---|---|---|
| `DATABASE_URL` | Supabase → your project → Settings → Database → **Transaction pooler** (port 6543, used in serverless paths). Replace `[YOUR-PASSWORD]` with the password you set when creating the project. | Yes |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3001` for local | Yes |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | [dashboard.clerk.com](https://dashboard.clerk.com) → your app → API keys → starts with `pk_test_` | Yes |
| `CLERK_SECRET_KEY` | Same page → starts with `sk_test_` | Yes |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest dashboard. Leave blank locally — `npm run inngest:dev` works unauthenticated. | No (locally) |
| `RESEND_API_KEY` | [resend.com/api-keys](https://resend.com/api-keys), starts with `re_`. Without this, `sendEmail()` logs and no-ops. | No (dormant without) |
| `RESEND_FROM_EMAIL` | `noreply@auckets.com` default. Won't actually send until the domain is verified in Resend. | Has default |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry project → Settings → Client Keys (DSN). Without this, Sentry init is a no-op. | No (dormant without) |

### 4. Run

```bash
npm run dev          # Next.js dev server on http://localhost:3001
```

In separate terminals as needed:

```bash
npm run inngest:dev  # Inngest dev UI, usually at http://localhost:8288
npm run email:dev    # React Email preview at http://localhost:3002
npm run db:studio    # Drizzle Studio for browsing the DB
```

### 5. Sanity check

Visit http://localhost:3001 → click "Sign up" → land on `/dashboard` showing your email. That's the Week 1 exit criterion working.

---

## Secrets hygiene

- **Bitwarden is the source of truth** for all keys (test and prod).
- **`.env.local` is a disposable local copy.** Lose it, recreate from Bitwarden.
- **Use `*_test_*` keys for local dev**, never prod keys. Clerk's test keys only work against test data; Stripe's test keys only charge test cards. Rotate freely.
- **Production keys live in Vercel project env settings**, never on your laptop, never in `.env.local`, never in git.
- **`.env*` files are gitignored** (except `.env.example`). The `.gitignore` is the safety net; don't rely on it being your only line of defense.
- **Don't paste secrets in chat with Claude / any AI assistant.** A file is slightly better but still visible to a watching assistant.

---

## Common gotchas

### "Cannot find server clerk.example.com" / Safari handshake fails

You're using the format-valid dummy Clerk keys. They pass env validation but point at a non-existent domain. Get real `pk_test_` and `sk_test_` keys from your Clerk dashboard.

### `npm run dev` → "Port 3000 is already in use"

We changed the default to **3001** in `package.json` because port 3000 was caught by a cached service worker on Josh's machine. If 3001 is also taken: `npm run dev -- -p 3010` (or any free port).

### `/api/inngest` returns `{"code":"internal_server_error"}`

Usually means Clerk middleware can't initialize because `CLERK_SECRET_KEY` is missing or malformed. Check `.env.local`.

### `npm run inngest:dev` says it can't reach the app

Make sure `npm run dev` is running in another terminal. The Inngest CLI polls `http://localhost:3001/api/inngest`.

### "Invalid URL" from `src/lib/env.ts` Zod errors

A required env var is missing or formatted wrong. The error names the var. Common causes:

- `DATABASE_URL` has literal `[brackets]` left in — those were placeholders. Strip them.
- `NEXT_PUBLIC_APP_URL` doesn't start with `http://` or `https://`.

### Build fails in CI but works locally

CI sets format-valid dummy Clerk keys at build time so the validator passes. If your build needs other vars at build time too, add them to `.github/workflows/ci.yml`.

### Build needs to skip env validation

```bash
SKIP_ENV_VALIDATION=1 npm run build
```

Refused in production (`NODE_ENV=production` + `SKIP_ENV_VALIDATION=1` throws at module load). Use for tooling-only builds.

---

## Running integration tests locally

The default `npm test` runs the mock-DB unit suite and needs no extra infra.
The real-Postgres integration suite (`tests/integration/`) needs Docker.

```bash
docker compose -f docker-compose.test.yml up -d   # Postgres on localhost:5433
npm run test:integration
docker compose -f docker-compose.test.yml down     # tear down when finished
```

Notes:

- The container uses port **5433** (not 5432) to avoid colliding with a
  developer's existing local Postgres install. If you've overridden
  `TEST_DATABASE_URL` in your shell, the test config respects it.
- Migrations apply automatically once per run (see
  `tests/integration/global-setup.ts`). No `db:migrate` step needed.
- The setup file refuses to run if `TEST_DATABASE_URL` points at anything
  that isn't `localhost` / `127.0.0.1` / the CI `postgres` service host.
  This is defense-in-depth so an accidentally-exported `DATABASE_URL` in
  your shell can't TRUNCATE staging.
- CI runs the same suite via `.github/workflows/ci.yml`'s `integration`
  job against an identical Postgres 17 service container, so a green
  local run reliably predicts CI.

---

## When `.env.local` schema changes

If you pull main and `npm run dev` complains about a missing env var, [`.env.example`](../.env.example) is the authoritative list. Diff your local against it and add any new lines.
