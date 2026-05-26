# Security

The non-negotiable security rules for AUCKETS. These are not suggestions and they are not subject to "we'll fix it later." If a PR violates one of these rules, it doesn't merge.

This is a working document — when we identify a new security requirement, it gets added here.

---

## Identity and authentication

1. **Every API route and server action checks authentication.** Even routes that "feel public." There are no anonymous endpoints in the application that touch the database, except for marketing pages that read fully public data.
2. **Authentication is via Clerk.** Custom auth is forbidden. If Clerk is down, AUCKETS is down — that's an acceptable tradeoff.
3. **Sessions are managed by Clerk's middleware.** We don't roll our own session logic.
4. **Authorization is checked after authentication.** Knowing *who* you are is not the same as knowing *what you can do*. Role and ownership checks happen at the route handler level, before business logic.
5. **Admin routes require an admin role check.** Not just authenticated. The check is explicit, not implicit.
6. **No backdoors.** No "if user email ends in @auckets.com, grant admin." Roles are explicit and stored in the database.

## Input validation

7. **Every API input is validated with Zod.** Including headers (idempotency keys), path parameters, query strings, and request bodies. No exceptions.
8. **Webhook payloads are validated for signature first, then schema.** Stripe webhooks verify the Stripe signature header before any processing. Clerk webhooks verify the Clerk signature header before any processing. If signature verification fails, return 401 immediately.
9. **Environment variables are validated with Zod at startup** via `src/lib/env.ts`. Missing required vars cause the build to fail, not a 2am runtime crash.
10. **User input is never trusted for authorization decisions.** If the client sends "I am user X," ignore it — use the session.

## Money and payments

11. **All money is integer cents.** No floats anywhere in the money path. See `CONVENTIONS.md` and ADR-0007.
12. **Raw card data never touches AUCKETS.** Stripe Elements handles card collection on the client; we receive only tokens.
13. **Stripe webhook signatures are verified.** Every time. Replay attacks are blocked by Stripe's signature verification combined with our idempotency.
14. **Stripe API calls use idempotency keys.** PaymentIntent creation, SetupIntent creation, refunds, transfers — all idempotent.
15. **Application fees are computed server-side.** Never derived from a client-submitted amount.
16. **Payment failures are logged but never expose internal details to the fan.** "Card declined, please try again" — not "Stripe error code 0x123 from upstream issuer."

## Allocation and fairness

17. **Allocation runs server-side.** The client never computes a rank, an assignment, or a price.
18. **The GAE is deterministic given its inputs.** No randomness, no time-of-day branches, no external data. This means an allocation decision is auditable and reproducible — critical for fairness disputes.
19. **The allocation log captures full state at decision time.** Not just "offer X placed in row Y" — the snapshot includes the rank ordering, the row state, the holds, the active sections. If a fan claims they were unfairly treated, we can reproduce the decision.
20. **Manual overrides require a logged reason.** Comping a seat or moving a group post-allocation is fine; doing it silently is not.

## Database and data handling

21. **Use parameterized queries always.** Drizzle does this by default. If you find yourself building SQL strings by hand, stop and use the query builder.
22. **`SELECT FOR UPDATE` on offer submission and during binding allocation.** Race conditions on seat assignment are a category of bug we will not tolerate.
23. **No manual database access in production.** All schema changes are migrations checked into the repo and applied via CI. Data fixes are scripts, reviewed, and run as controlled jobs.
24. **Production database backups are automated and tested.** Supabase handles the automation; we test restore quarterly (see `RUNBOOK.md`).
25. **PII is minimized.** We collect email and optionally phone. We do not collect SSNs, dates of birth, home addresses, or other PII unless a specific compliance need requires it.
26. **The Supabase publishable/anon key is treated as a private credential.** It must never be embedded in client-side bundles, `NEXT_PUBLIC_*` env vars, or any code path that ships to a browser. AUCKETS deliberately does not use Supabase row-level security ([ARCHITECTURE.md §Database](ARCHITECTURE.md#database-supabase-postgres)) — Clerk and route handlers are the authorization layer. The tradeoff: if the anon key ever leaks to the browser, PostgREST grants full read access to every public table with no defense in depth. The app reaches Postgres only through Drizzle on the service-role connection, server-side. The `@supabase/supabase-js` client is not installed and should not be added. If we ever decide to expose Supabase to the client (PostgREST, Realtime, Storage), that requires an ADR and an RLS policy rollout *first*, not after.

## Secrets

27. **Secrets are never committed.** `.env*` files (except `.env.example`) are gitignored. If a secret is committed, rotate it immediately, then update the rotation runbook.
28. **Secrets are environment-scoped.** Production keys never appear in staging or local environments. Each environment has its own Clerk instance, Stripe account configuration, and Resend domain config.
29. **API keys are stored in Vercel environment variables** for the app and Supabase environment variables for the database. Never in code, never in a config file checked into git.
30. **Rotate compromised credentials immediately.** If a key leaks (committed, accidentally pasted in a shared doc, exposed in a screenshot), rotate that day. Don't wait.

## Logging and observability

31. **Never log secrets.** API keys, passwords, full card numbers, full Stripe customer secrets, Clerk JWT contents. Pino is configured to redact `password`, `token`, `secret`, `apiKey`, `authorization`, `cookie` fields by default; do not log fields with these names.
32. **Never log full request bodies on error.** Log enough context to debug (user ID, route, error category) without leaking what the user submitted.
33. **Sentry scrubbing is configured.** PII fields are stripped from error reports.

## Deployment and infrastructure

34. **`main` is protected.** Required CI checks must pass. Force-push is disabled.
35. **No direct production deploys from a laptop.** Production deploys via Vercel's GitHub integration, triggered by merge to main. Staging similarly.
36. **Migrations run in CI before deploy.** A failed migration aborts the deploy.
37. **Rollback procedure is documented and tested.** See `RUNBOOK.md`.

## Third-party access

38. **HFC's access is revoked before production cutover.** Their admin access to Stripe and any other accounts is removed before any real money flows. This is on the project go-live checklist.
39. **Least privilege for any service account.** Vercel, Supabase, Clerk admins are scoped to who needs them. Audit every quarter.
40. **No shared credentials.** Each person has their own Vercel/Supabase/Clerk login. If a person leaves, their accounts are revoked individually.

## Fan trust

41. **The "no hidden fees" promise is honored at the architecture level.** Service fees, processing fees, "facility fees" — none of it. If a fee structure changes in the future, it's an explicit product decision documented in an ADR.
42. **Fans can see why they were placed where they were.** The allocation log enables a "your offer was ranked #N, placed in row X because of [reason]" view, even if that view isn't built yet.
43. **Refund requests are handled through Stripe, not by editing the database.** Refunds flow through Stripe's API; the database reflects what Stripe says happened.

## Incident response

44. **A security incident is treated as the most important thing.** Drop everything else. Rotate affected credentials. Notify users if their data is exposed. Document the incident in `docs/incidents/` with date, cause, impact, and remediation.
45. **Vulnerability disclosures are taken seriously.** If a fan or researcher reports a security issue, acknowledge within 24 hours.

---

## Pre-launch checklist

Before any show goes live with real money, confirm:

- [ ] Stripe in correct mode (live keys, not test).
- [ ] HFC admin access revoked from Stripe and any other production-tier accounts.
- [ ] Production Supabase project has automated backups enabled.
- [ ] Sentry alerts configured for critical errors.
- [ ] All env vars present in production (verified via Zod schema at build time).
- [ ] Webhook endpoints verified — Stripe sends a test event, signature is verified.
- [ ] Rate limiting configured on offer submission.
- [ ] Stress test passed: 200+ simultaneous offer submissions.
- [ ] One full restore drill completed from a Supabase backup.
- [ ] Show-day runbook reviewed.
- [ ] Confirmed no `NEXT_PUBLIC_SUPABASE_*` env vars exist and `@supabase/supabase-js` is not in `package.json` (rule 26).

## Periodic audits

Quarterly:
- Rotate any credentials that allow this.
- Review service-account access (Vercel, Supabase, Clerk, Stripe).
- Restore drill from a recent backup.
- Sentry / Inngest / log retention review (don't accumulate forever).

Yearly:
- Full security review of the codebase.
- Dependency audit (`npm audit`, Dependabot, Snyk — pick one).
- Verify the disaster recovery plan still matches reality.
