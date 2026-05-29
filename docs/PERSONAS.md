# Personas — navigation & experience (alpha-friction audit)

**Written 2026-05-28.** Lens: **friction an alpha user hits on the surfaces that exist today.** Not a future-journey design doc — where a step is simply unbuilt (TicketViewer, Scanner, AllocationFinal), that's a blocker tracked in [`REMAINING_WORK.md`](REMAINING_WORK.md), and it's only mentioned here where it leaves a *dead end in a journey that otherwise starts*. The goal is to fix the rough edges while alpha is still running.

Three personas for MVP (ADR-0012): **FAN**, **ARTIST**, **AUCKETS_ADMIN**. (`VENUE_STAFF` arrives with the Scanner for Austin.)

Severity key: **🔴 blocks the journey · 🟠 confuses or strands the user · 🟡 papercut.**

---

## How a user enters and what role they get

- Sign-up / sign-in is Clerk's modal, launched from the header ([`SiteNav.tsx`](src/components/nav/SiteNav.tsx)). Every signed-in user lands on `/dashboard` (the **fan** view).
- The nav is role-aware: it only shows artist links for artists you can manage, and the **Requests** link + **Admin** pill for admins ([`SiteNav.tsx:71-95`](src/components/nav/SiteNav.tsx)).
- **There is no self-serve path to become an artist or an admin.** Those grants are seeded by SQL. For a closed alpha that's acceptable, but it means onboarding Cope (or a test artist) is a manual DB step, not a flow.

🟠 **Cross-cutting onboarding gap:** a brand-new artist or admin signs up, sees only the fan dashboard, and looks "stuck" until someone runs SQL to grant the role. Worth a runbook entry at minimum.

---

## FAN — the most-exercised path today

**Journey as built:** sign up → `/dashboard` (open shows) → click a show → `/shows/[id]` (compose offer + see live preview/rank) → submit → bounced back to `/dashboard`. History lives at `/my-bids`.

What's genuinely good: the dashboard empty state and "Heads up" binding note are clear ([`dashboard/page.tsx:120-169`](src/app/(fan)/dashboard/page.tsx)); the show-detail right column (PreviewBanner + VenuePreview + RankBoard) gives a real "where would I land" picture; `/my-bids` shows full revision history.

Friction:

1. 🟠 **Submitting an offer ends in silence.** On success the composer does `router.push("/dashboard")` ([`OfferComposer.tsx:243`](src/components/show/OfferComposer.tsx)) — no confirmation, no "you're in the room" moment (Allocation.jsx is unbuilt). A first-time fan can't tell the submit worked except by spotting their offer chip back on the dashboard. This is the single highest-impact fan papercut and it's cheap to fix (a confirmation state or toast before/instead of the bare redirect).

2. 🟠 **The auto-bid toggle doesn't do anything yet.** The composer collects "Auto-raise if I'm displaced" + a cap ([`OfferComposer.tsx:292-347`](src/components/show/OfferComposer.tsx)), but the allocation layer strips those fields — `translate.test.ts:140-141` asserts the ranked offer carries neither. There's no displacement detection (DisplacementToast deferred) and no raise mechanism. So we're showing fans a control that makes a promise the system doesn't keep. Options: hide it for alpha, or label it "coming soon." Leaving it live risks a fan setting a cap and being silently displaced anyway.

3. 🟠 **Tier labels are hardcoded to "Premium."** The radio options read "Premium only / Premium or below," and the payload always sends `preferredTier = "premium"` ([`OfferComposer.tsx:62-78, 188-190`](src/components/show/OfferComposer.tsx)). If a show's venue isn't structured around a tier literally named "premium," the copy misleads. Fine for the seeded alpha show; a trap the moment a second venue shape exists.

4. 🟡 **Revision re-collects the card every time.** Saved-card reuse isn't built, so a fan revising upward re-types their card on each revision ([`OfferComposer.tsx` header note](src/components/show/OfferComposer.tsx)). Annoying but not blocking; the Stripe Customer attach is already the groundwork.

5. 🟠 **No way to withdraw an offer.** The composer only submits/revises, and the rule is "revise upward, never downward." A fan who changes their mind has no exit. May be an intentional commitment device — flag for product, don't assume.

6. 🔴 **The journey dead-ends at "placed."** After a binding run a placed fan has nowhere to get a ticket (TicketViewer unbuilt) and no result page (AllocationFinal unbuilt). The dashboard only lists *open* shows ([`listOpenShows`](src/app/(fan)/dashboard/page.tsx:39)), so once a show closes it drops off the dashboard entirely — the fan's own result is only inferable from `/my-bids`. These are the hard/soft blockers; noted here because they're where the fan journey stops cold.

7. 🟠 **The whole fan journey is silent — no email fires anywhere.** Only the `welcome` template exists and nothing triggers it; offer-received / placed / not-placed / allocation-imminent are unbuilt. An alpha fan must keep reloading the site to learn anything. (Soft blocker #6 in REMAINING_WORK.)

---

## ARTIST (Cope) — read-rich, action-poor

**Journey as built:** nav link to `/artists/[id]` (only if granted) → artist dashboard (snapshot + show rows) → click a show → `/artists/[id]/shows/[id]` ShowAdmin (tabbed: stats, activity, distribution, placement map, holds) → file a "Request action" for pause/end-early/comp/override.

What's good: the ShowAdmin tabbed shell is dense and informative; the request-filing dialog matches ADR-0013 (artists request, ops execute).

Friction:

1. 🔴 **An artist can't create a show.** The "New show" button is deliberately omitted because ShowCreate is unbuilt ([`artists/[artistId]/page.tsx:158-160`](src/app/(artist)/artists/[artistId]/page.tsx)). Every new show is a Julia/SQL task. For alpha with one show, fine; it's the first thing Cope will reach for.

2. 🟠 **The artist can't run a preview of their own show.** ShowAdmin passes `canRunPreview={isAdmin}` and `canRunBinding={isAdmin}` ([`shows/[showId]/page.tsx:231-232`](src/app/(artist)/artists/[artistId]/shows/[showId]/page.tsx)). So the provisional placement map an artist sees only updates when an *admin* runs preview. An artist who opens their show before ops has run anything sees an empty/stale placement and has no button to refresh it. Decide intentionally: is preview an ops-only lever, or should artists self-serve it?

3. 🟠 **Filed requests disappear from the artist's view.** Nothing on the artist side reads `artist_requests` (grep finds no reference in `(artist)/` or `components/artist/`). The artist files a pause/comp request and then has no in-app record that it exists or whether ops executed it — the only feedback path is the RequestActioned email, which is dormant until Resend is verified. So today: file → void. Surfacing request status on ShowAdmin is a small, high-value slice.

4. 🟡 **No Fans tab.** The artist can't see who's coming or contact them (pending the privacy review, ADR-0017). Expected gap; listed so it's not a surprise.

---

## AUCKETS_ADMIN (Julia) — the operator

**Journey as built:** nav **Admin** pill → `/admin` command center (shows list across all artists) → click a show → the (unscoped) ShowAdmin, where preview/binding buttons live → **Requests** → `/admin/requests` inbox (open/executed/denied tabs with counts + inline execute/deny).

What's good: the requests inbox is genuinely complete — FIFO queue, status tabs with live counts, inline actions, "inbox zero" empty state ([`admin/requests/page.tsx`](src/app/(admin)/admin/requests/page.tsx)). The shows-list spine is clean and links straight into per-show management.

Friction:

1. 🟠 **The command center is two sections; everything else is SQL.** `/admin` is the shows list; `/admin/requests` is the inbox. The planned Offers / Tickets / Money / Allocations / People / Simulation sections are unbuilt ([initiative in REMAINING_WORK.md](docs/REMAINING_WORK.md)). To answer "is this fan's card actually authorized?", "what did the last allocation decide and why?", or "who's attending?" Julia drops to the database. For running even one real beta show, the **Money** view (held auths/captures) and **Allocations** view (the GAE log) are the most felt gaps.

2. 🟠 **Binding is a button someone has to remember to press.** There's no scheduled job (`src/lib/jobs/functions/` is just `hello.ts`); binding runs only when an admin clicks "Run binding" on ShowAdmin. For a supervised alpha that's tolerable, but it's an operational trap — miss the checkpoint and the run doesn't happen. (Strong blocker #5.)

3. 🟠 **No people/fan lookup.** A fan emails "where's my seat?" and there's no UI to find them or their offers across shows. Support is a SQL query today.

4. 🟡 **Admin reuses the artist-scoped ShowAdmin** for per-show work, which is the right call (same presenters, unscoped) — noting it so the shared surface isn't mistaken for a gap.

---

## Triage — what to fix while alpha runs

**Quick wins (small, no external dependency, high felt value):**
- Offer-submit confirmation instead of a silent redirect (fan #1).
- Decide + act on the auto-bid toggle: hide or "coming soon" until the engine exists (fan #2).
- Surface filed-request status on the artist ShowAdmin (artist #3).
- A runbook entry (or tiny admin action) for granting artist/admin roles (onboarding gap).

**Needs a slice (already in the beta plan; this audit just confirms the priority):**
- TicketViewer + AllocationFinal close the fan dead-end (fan #6) — hard/soft blockers.
- Fan emails end the silence (fan #7) — soft blocker.
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
