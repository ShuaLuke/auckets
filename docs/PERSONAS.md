# Personas — navigation & experience (alpha-friction audit)

**Written 2026-05-28.** Lens: **friction an alpha user hits on the surfaces that exist today.** Not a future-journey design doc — where a step is simply unbuilt (TicketViewer, Scanner, AllocationFinal), that's a blocker tracked in [`REMAINING_WORK.md`](REMAINING_WORK.md), and it's only mentioned here where it leaves a *dead end in a journey that otherwise starts*. The goal is to fix the rough edges while alpha is still running.

> **Update 2026-05-31:** much of this audit has been actioned. Items marked **✅ RESOLVED** inline below have shipped: the fan dead-end (TicketViewer #68, AllocationFinal #96), the silent submit (inline "You're in the pool" state), fan emails (#90, dormant until Resend verified), show creation (#86/#89), scheduled binding (#78), filed-request visibility (FiledRequestsPanel, #97), and the VENUE_STAFF onboarding path (#87). Still-open items (auto-bid UX, hardcoded tier, withdrawal, admin command-center sections, fan lookup) are unchanged.

Three personas for MVP (ADR-0012): **FAN**, **ARTIST**, **AUCKETS_ADMIN**. (`VENUE_STAFF` shipped with the Scanner, #82/#87.)

Severity key: **🔴 blocks the journey · 🟠 confuses or strands the user · 🟡 papercut.**

---

## How a user enters and what role they get

- Sign-up / sign-in is Clerk's modal, launched from the header ([`SiteNav.tsx`](src/components/nav/SiteNav.tsx)). Every signed-in user lands on `/dashboard` (the **fan** view).
- The nav is role-aware: it only shows artist links for artists you can manage, and the **Requests** link + **Admin** pill for admins ([`SiteNav.tsx:71-95`](src/components/nav/SiteNav.tsx)).
- **There is no self-serve path to become an artist or an admin.** Those grants are seeded by SQL. For a closed alpha that's acceptable, but it means onboarding Cope (or a test artist) is a manual DB step, not a flow.

🟠 **Cross-cutting onboarding gap:** a brand-new artist or admin signs up, sees only the fan dashboard, and looks "stuck" until someone runs SQL to grant the role. The grant procedure is now documented ([`runbooks/granting-roles.md`](runbooks/granting-roles.md)); a self-serve flow is still future work. VENUE_STAFF grants have a dedicated `/admin/staff` UI (#87).

---

## FAN — the most-exercised path today

**Journey as built:** sign up → `/dashboard` (open shows) → click a show → `/shows/[id]` (compose offer + see live preview/rank) → submit → bounced back to `/dashboard`. History lives at `/my-bids`.

What's genuinely good: the dashboard empty state and "Heads up" binding note are clear ([`dashboard/page.tsx:120-169`](src/app/(fan)/dashboard/page.tsx)); the show-detail right column (PreviewBanner + VenuePreview + RankBoard) gives a real "where would I land" picture; `/my-bids` shows full revision history.

Friction:

1. ✅ **RESOLVED — Submitting an offer ends in silence.** The composer now renders an inline success state ("You're in the pool") instead of the silent redirect ([`OfferComposer.tsx:158, 425`](src/components/show/OfferComposer.tsx)). A fan gets explicit confirmation that the submit worked.

2. 🟠 **The auto-bid toggle doesn't do anything yet.** The composer collects "Auto-raise if I'm displaced" + a cap ([`OfferComposer.tsx:292-347`](src/components/show/OfferComposer.tsx)), but the allocation layer strips those fields — `translate.test.ts:140-141` asserts the ranked offer carries neither. There's no displacement detection (DisplacementToast deferred) and no raise mechanism. So we're showing fans a control that makes a promise the system doesn't keep. Options: hide it for alpha, or label it "coming soon." Leaving it live risks a fan setting a cap and being silently displaced anyway.

3. 🟠 **Tier labels are hardcoded to "Premium."** The radio options read "Premium only / Premium or below," and the payload always sends `preferredTier = "premium"` ([`OfferComposer.tsx:62-78, 188-190`](src/components/show/OfferComposer.tsx)). If a show's venue isn't structured around a tier literally named "premium," the copy misleads. Fine for the seeded alpha show; a trap the moment a second venue shape exists.

4. 🟡 **Revision re-collects the card every time.** Saved-card reuse isn't built, so a fan revising upward re-types their card on each revision ([`OfferComposer.tsx` header note](src/components/show/OfferComposer.tsx)). Annoying but not blocking; the Stripe Customer attach is already the groundwork.

5. 🟠 **No way to withdraw an offer.** The composer only submits/revises, and the rule is "revise upward, never downward." A fan who changes their mind has no exit. May be an intentional commitment device — flag for product, don't assume.

6. ✅ **RESOLVED — The journey no longer dead-ends at "placed."** TicketViewer (#68) gives a placed fan a geo-gated rotating-QR ticket; AllocationFinal (#96, `/allocation/[showId]`) is the placed/not-placed result page. The public `/shows` index (#98) also means a closed show is still reachable. The fan journey now runs end-to-end through the door.

7. ✅ **RESOLVED (code) — The fan journey is no longer silent.** offer-received / placed / not-placed / allocation-imminent / card-failure templates + senders shipped (#90, `src/lib/notifications/fan.ts`). **Dormant until ops verifies `auckets.com` in Resend + sets `RESEND_API_KEY`** — until then alpha fans still get no email, but no code work remains.

---

## ARTIST (Cope) — read-rich, action-poor

**Journey as built:** nav link to `/artists/[id]` (only if granted) → artist dashboard (snapshot + show rows) → click a show → `/artists/[id]/shows/[id]` ShowAdmin (tabbed: stats, activity, distribution, placement map, holds) → file a "Request action" for pause/end-early/comp/override.

What's good: the ShowAdmin tabbed shell is dense and informative; the request-filing dialog matches ADR-0013 (artists request, ops execute).

Friction:

1. ✅ **RESOLVED — An artist can't create a show.** ShowCreate shipped (#86) with an inline "create venue" path (#89): `ShowCreateForm` + `POST /api/shows` + `createShow`. Shows no longer need a SQL/Julia task. (Full VenueBuilder — editing an existing venue's architecture — is still post-beta.)

2. ✅ **RESOLVED (by decision) — The artist can't run a preview of their own show.** Decided intentionally (NEW-10): preview stays ops-only (`canRunPreview={isAdmin}`), but the show view now auto-runs an in-memory preview projection so an artist never sees a stale/empty placement map. The "no refresh button" concern is gone.

3. ✅ **RESOLVED — Filed requests disappear from the artist's view.** ShowAdmin now surfaces filed-request status via `FiledRequestsPanel` ([`shows/[showId]/page.tsx`](src/app/(artist)/artists/[artistId]/shows/[showId]/page.tsx) + `components/artist/FiledRequestsPanel.tsx`). The file → void gap is closed; the artist sees their requests and their status in-app.

4. 🟡 **No Fans tab.** The artist can't see who's coming or contact them (pending the privacy review, ADR-0017). Expected gap; listed so it's not a surprise.

---

## AUCKETS_ADMIN (Julia) — the operator

**Journey as built:** nav **Admin** pill → `/admin` command center (shows list across all artists) → click a show → the (unscoped) ShowAdmin, where preview/binding buttons live → **Requests** → `/admin/requests` inbox (open/executed/denied tabs with counts + inline execute/deny).

What's good: the requests inbox is genuinely complete — FIFO queue, status tabs with live counts, inline actions, "inbox zero" empty state ([`admin/requests/page.tsx`](src/app/(admin)/admin/requests/page.tsx)). The shows-list spine is clean and links straight into per-show management.

Friction:

1. 🟠 **The command center is two sections; everything else is SQL.** `/admin` is the shows list; `/admin/requests` is the inbox. The planned Offers / Tickets / Money / Allocations / People / Simulation sections are unbuilt ([initiative in REMAINING_WORK.md](docs/REMAINING_WORK.md)). To answer "is this fan's card actually authorized?", "what did the last allocation decide and why?", or "who's attending?" Julia drops to the database. For running even one real beta show, the **Money** view (held auths/captures) and **Allocations** view (the GAE log) are the most felt gaps.

2. ✅ **RESOLVED — Binding is a button someone has to remember to press.** Scheduled binding shipped (#78): the `scheduled-binding` Inngest cron sweeps shows past `binding_allocation_at` (`src/lib/jobs/functions/` now holds scheduled-binding, ticket-issuance, allocation-imminent, card-failure-expiry — not just `hello.ts`). The manual "Run binding" button remains as a supervised fallback; the missed-checkpoint trap is gone.

3. 🟠 **No people/fan lookup.** A fan emails "where's my seat?" and there's no UI to find them or their offers across shows. Support is a SQL query today.

4. 🟡 **Admin reuses the artist-scoped ShowAdmin** for per-show work, which is the right call (same presenters, unscoped) — noting it so the shared surface isn't mistaken for a gap.

---

## Triage — what to fix while alpha runs

**Quick wins (small, no external dependency, high felt value):**
- ~~Offer-submit confirmation instead of a silent redirect (fan #1).~~ ✅ shipped.
- Decide + act on the auto-bid toggle (fan #2). — **still open.** Auto-bid now functions at allocation (#72/#73), but the composer UX/copy and the Cope-pending raise rule (NEW-13) still need a pass.
- ~~Surface filed-request status on the artist ShowAdmin (artist #3).~~ ✅ shipped (#97).
- ~~A runbook entry for granting artist/admin roles (onboarding gap).~~ ✅ shipped ([`runbooks/granting-roles.md`](runbooks/granting-roles.md)).

**Needs a slice — now ✅ shipped (this audit confirmed the priority; the work landed):**
- ~~TicketViewer + AllocationFinal close the fan dead-end (fan #6).~~ #68 / #96.
- ~~Fan emails end the silence (fan #7).~~ #90 (dormant until Resend verified).
- Admin **Money** + **Allocations** command-center sections (admin #1).
- Scheduled binding (admin #2).
- ShowCreate UI (artist #1).

**Needs a product decision (don't assume):**
- Can fans withdraw an offer? (fan #5)
- Is preview an ops-only lever or artist self-serve? (artist #2)
- Per-show tier naming vs. the hardcoded "premium" (fan #3).

---

## How to use this doc

This is a point-in-time audit of shipped surfaces. When a friction item is fixed, strike it or move it to a "resolved" note with the PR number. When a blocker that creates a dead-end here ships (e.g. TicketViewer), revisit the affected persona journey end-to-end — fixing the dead-end often surfaces the *next* rough edge behind it.
