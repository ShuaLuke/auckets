# Runbook

Operational procedures for AUCKETS. This document is lighter at MVP and grows over time as we encounter real situations. The principle is: if you ever have to think about how to do something operational, write down what you figured out so the next person doesn't have to.

---

## Environments

| Environment | URL | Database | Stripe | Clerk |
|---|---|---|---|---|
| Local | `http://localhost:3001` | Local Supabase (or shared dev project) | Test keys | Dev instance |
| Staging | `https://staging.auckets.com` (TBD) | Staging Supabase project | Test keys | Staging instance |
| Production | `https://auckets.com` (TBD) | Production Supabase project | Live keys | Production instance |

**The mental model:** local is yours to break. Staging mirrors production with test money. Production is real money on the line. Don't mix any of these.

## First-time developer setup

```bash
git clone <repo-url>
cd auckets
npm install
cp .env.example .env.local
# Fill in .env.local with your dev credentials (Clerk dev, Supabase dev, Stripe test, etc.)
npm run db:migrate            # Apply migrations to your dev DB
npm run db:seed               # Seed test data
npm run dev                   # Start at localhost:3001
```

If something fails at this stage, fix the doc — the next person should hit the same wall.

## Day-to-day commands

```bash
npm run dev                   # Start the Next.js dev server
npm run typecheck             # tsc --noEmit
npm run lint                  # ESLint
npm run test                  # Vitest unit tests
npm run test:e2e              # Playwright e2e tests
npm run db:migrate            # Apply migrations
npm run db:generate           # Generate a new migration from schema changes
npm run db:studio             # Drizzle Studio — visual DB browser
npm run test:integration      # Real-Postgres repository suites (needs local PG on :5433 — see runbooks/local-dev.md)
```

(The planned `npm run gae:run <venue> <offers>` CLI from Week 2 was never built — the admin "Preview allocation" button serves the same debugging purpose against real-DB data.)

## Deploying

We don't deploy manually. The flow is:

1. Open a PR against `main`.
2. CI runs (typecheck, lint, tests). PR can't merge without green CI.
3. Merge to `main`.
4. Vercel auto-deploys to staging (TBD; possibly production depending on configuration).
5. Migrations apply automatically as part of the deploy.

For preview deploys: open a PR; Vercel deploys a preview URL automatically.

For hotfixes to production: same flow, but mark the PR `[hotfix]` in the title and merge as soon as CI passes. Don't bypass CI.

## Rolling back

If a deploy goes bad:

1. **Revert the commit on main** via GitHub UI ("Revert" button on the merged PR).
2. CI runs on the revert PR; merge once green.
3. Vercel deploys the revert.
4. If the bad deploy included a migration, check whether the migration is reversible:
   - Drizzle migrations are not auto-reversible. If you need to undo a schema change, write a forward migration that reverts it.
   - For data corruption: restore from backup (see below).

The instinct to "fix forward" is usually wrong in a crisis. Revert first, fix calmly, redeploy.

## Database backups

Supabase handles automated backups (point-in-time recovery on paid plans). Confirm:

- Daily snapshots retained for at least 7 days.
- Point-in-time recovery available for at least 24 hours.

**Restore drill (quarterly):**

1. Spin up a scratch Supabase project.
2. Restore the most recent production backup to it.
3. Connect a local copy of the app to the scratch project.
4. Verify: schema is intact, seed data is present, a few sample queries return what you'd expect.
5. Tear down the scratch project.
6. Document the time it took and any issues encountered.

If the restore takes longer than 30 minutes for our data size, we need to know that before we need to know that.

## Stripe operations

### Switching Stripe accounts (from HFC's to ours)

Per Q3 in `OPEN_QUESTIONS.md` — this needs to happen before production launch.

1. Confirm Auckets Stripe account is configured for Connect Express.
2. Update production env vars in Vercel to point at the Auckets account keys.
3. Reconfigure webhook endpoints in the Auckets Stripe dashboard to point at our production webhook URL.
4. Test with a small live charge before any real show.
5. Revoke HFC's admin access to the Auckets Stripe account.
6. Document the cutover date in this file.

### Refunds

Refunds flow through the Stripe dashboard or API. They are **never** done by manually editing our database.

1. Locate the charge in Stripe dashboard (search by metadata: offer ID).
2. Issue the refund via Stripe.
3. Our webhook handler updates the offer status to REFUNDED automatically.
4. If the webhook didn't fire, check Inngest logs; replay if needed.

### Chargebacks

If a chargeback comes in:

1. Stripe webhook fires; we capture the dispute.
2. Pull all relevant data from `allocation_logs` and `seat_assignments` for that offer — this is the evidence.
3. Respond via Stripe dashboard with the audit trail.
4. The allocation log's snapshot data is your friend here.

## Clerk operations

### User issues

If a user reports they can't log in:

1. Find them in the Clerk dashboard by email.
2. Check session state, password reset attempts.
3. Common fix: send them a password reset or magic link via Clerk's UI.

### Webhook desync

If our `users` table is out of sync with Clerk (Clerk has a user we don't):

1. Check Inngest logs for the user-creation webhook for that user ID.
2. Replay if it failed.
3. Manual fix script in `scripts/sync-clerk-user.ts` (write this once we hit the case).

## Show-day runbook

For any show with more than ~20 attendees. A dedicated `docs/runbooks/show-day.md` is not yet written (Week 7 item — see ROADMAP); the summary checklist below is the interim:

### T minus 7 days

- [ ] Show is configured correctly in artist dashboard.
- [ ] Venue architecture verified.
- [ ] Pricing reviewed with Cope.
- [ ] Stripe in correct mode.
- [ ] Backups confirmed recent.

### T minus 24 hours

- [ ] Binding allocation checkpoint runs as scheduled (or manually triggered).
- [ ] Payment success rate reviewed (>95% expected).
- [ ] Outbid emails sent and tracked.
- [ ] Accepted emails sent with seat details.
- [ ] Failed payments retry window communicated to affected fans.

### Show day

- [ ] On-call confirmed (probably Josh, possibly Cope as backup).
- [ ] Door scanner ready (if applicable).
- [ ] Attendance recording mechanism working.
- [ ] Sentry alerts triaged before doors open.

### Post-show

- [ ] Reconciliation report run: total revenue matches Stripe, seat assignments match attendance, no orphaned charges.
- [ ] Retro document started.
- [ ] BOND_EVENT entries appended for attendance.

## Incidents

If something goes wrong during a show:

1. **Don't panic.** Most "the system is down" reports are not the system being down.
2. **Check Sentry** for active errors.
3. **Check Inngest** for stuck jobs.
4. **Check Stripe dashboard** for payment health.
5. **Check Supabase dashboard** for connection issues.
6. **Check Vercel dashboard** for deployment issues or function timeouts.

If a real incident is unfolding:

1. Communicate with whoever is at the show (Cope, venue staff).
2. Decide: ride it out, manually intervene, or pause the show flow.
3. Document what happened in a new file under `docs/incidents/YYYY-MM-DD-<short-name>.md`.
4. Include: timeline, impact, root cause (once known), remediation steps, lessons learned.

## On-call expectations

For the first few shows, "on-call" is Josh during the show window plus 2 hours before and 1 hour after. After the Austin show, formalize:

- Primary on-call rotation.
- Secondary (backup) on-call.
- Communication channel (Slack, signal, phone).
- Response time SLA (e.g., 5 minutes during a show, 1 hour off-hours).

## Things to add to this document over time

This runbook will be incomplete until we've run several shows. As situations come up that the next person should know about, add a section here. Likely additions:

- Specific Inngest job patterns and how to debug stuck jobs.
- Vercel function timeout patterns and how to work around them.
- The specific seat-numbering quirks of each venue (because every venue has quirks).
- How to handle a venue that changes capacity day-of (production holds added late).
- How to handle Stripe's edge cases (3DS challenges that fail at allocation time, etc.).

When something happens that wasn't documented, document it. That's how this becomes useful.
