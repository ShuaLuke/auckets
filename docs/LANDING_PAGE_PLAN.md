# Landing page plan

Plan for reworking the home page (`/`, [`src/app/page.tsx`](../src/app/page.tsx)).
Two problems: the content is aimed only at first-time prospects, and
logged-in users get the same first-timer pitch instead of a returning-user
home. Companion to [`MOBILE_RESPONSIVE_PLAN.md`](MOBILE_RESPONSIVE_PLAN.md).

Written 2026-05-29. **✅ COMPLETED — shipped via #83 (auth-/role-aware home with real-show hero) and #98 (public `/shows` lineup + nav link + landing CTA).** This doc is now historical: the logged-out real-soonest-show hero, the role-aware signed-in home, the `listOpenShows` server-side data path (no anon key), and the no-demand-signal safeguards all landed. Kept for the design reasoning.

---

## TL;DR

`/` is a static marketing landing that only swaps CTA *labels* for
logged-in users (Clerk `<SignedIn>/<SignedOut>`). Everything else — "How
it works", the auction comparison, the FAQ titled *"Things people ask
before their first offer"*, the "Pitch your venue" artist CTA — assumes a
prospect. Returning fans, artists, and admins all land on a sales page
instead of their own surfaces.

The hero ticket card is a hardcoded mock with a **past date** ("Sat May
25", no year) that reads as broken on a live site. And the "See an
upcoming show →" CTA points at `/dashboard`, which bounces logged-out
visitors to `/sign-in` — a dead-end funnel.

Plan: make `/` auth- and role-aware — a personalized home for logged-in
users (keeping a light marketing strip), the full marketing landing for
logged-out — and replace the stale mock with the real soonest open show.

---

## Decisions (locked with Julia, 2026-05-29)

- **Logged-in `/` = personalized home that still keeps some marketing.**
  Not a redirect. Returning users see a welcome + their next show /
  active offers / quick links, then a trimmed marketing strip below.
- **Hero card pulls the real soonest open show**, with an evergreen mock
  fallback when nothing is open.
- **Logged-out "See a show" CTA** → repoint to an in-page "How it works"
  anchor, or prompt sign-in. No public show-preview page is built (both
  `/dashboard` and `/shows/[id]` redirect anonymous visitors to
  `/sign-in`, by design).
- **Surfacing real show data publicly is OK** — show metadata / high-level
  info only. Confirmed not a vulnerability given the safeguards below.

## Public show data — security safeguards (the conditions that make it safe)

Show metadata (artist, venue, date, status, floor price) is poster-level
public info. It's safe to surface on the logged-out hero *only if*:

1. **Server-side reads via Drizzle only.** Landing is a server component
   using `db`. No client `@supabase/supabase-js`, no anon key in the
   client — a leaked anon key = full DB read via PostgREST (RLS is
   deny-all). No new transport surface.
2. **Reuse the curated summary, not the authed loader.** Pull from
   `listOpenShows` (already filters `status = "open"`, already a
   whitelisted `SHOW_SUMMARY_SELECTION`). Drafts/paused/unannounced shows
   are excluded by construction. Do NOT reuse the show page's
   `loadShowDetail` — it carries offers, seat assignments, rank pools,
   displacement events (per-user + internal).
3. **No demand signals.** artist/venue/date/status/"from $X floor" only.
   Never expose live offer counts, fill %, rank distribution, or
   capacity-remaining — those reveal demand and could help game the
   allocation (authed-only on RankBoard). Drop the fabricated
   "Orchestra · Row AA · seats 7–10" line; never show a fake seat.
4. **Confirm `open` == "okay to be public" (product, not code).** Today
   `status="open"` means "open for offers." If a show can be `open` before
   you want to market it, add an explicit announced/visibility flag rather
   than overloading `open`. No separate visibility flag exists today.

## Marketing copy — separate analysis (out of scope for this plan)

The FAQ / marketing copy needs its own dedicated review, not a line-item
here. Confirmed accurate against code so far: the `rank_key` formula and
revise-upward-only. Known suspects for that review: "no service fees,"
"Stripe fees come from the artist payout," the "charged 24h before doors"
timing (gated on the unconfirmed ADR-0003), and the first-timer framing
throughout. **Treat as a blocker for the logged-out slice** — wrong copy
on the most-visited page is a trust issue — but tracked as its own
workstream.

---

## Target behavior

### Logged-out (`<SignedOut>`) — the marketing landing, fixed
- Keep the existing sections: Hero, How it works, Comparison, For
  artists, FAQ, Footer.
- Hero ticket card → real soonest open show (evergreen fallback). Real,
  non-misleading fields only.
- Fix the dead-end "See a show" CTA per the open decision above.
- Apply the FAQ/claims copy review.

### Logged-in — personalized home, role-aware
Resolve role server-side (reuse `userIsAdmin` /
`listArtistsManageableByUser`, the same calls [`SiteNav`](../src/components/nav/SiteNav.tsx)
already makes).
- **Welcome band** — greeting + identity.
- **Fan**: soonest open show with their offer status (placed / preview /
  no offer yet), a short active-offers summary, quick links to Dashboard
  and My bids.
- **Artist** (member of ≥1 artist): cards/links to each manageable
  artist's management page.
- **Admin**: links to `/admin` and the Requests inbox.
- **Light marketing strip below** (the "some marketing still" the
  decision calls for): keep a condensed "How it works" refresher and/or
  the "For artists" section. Drop the first-timer FAQ for logged-in users.

---

## Implementation sketch

`page.tsx` becomes a server component that branches on `auth()` + role.
The existing section functions (`Hero`, `HowItWorks`, `ComparisonBand`,
`ForArtists`, `Faq`, `Footer`) stay file-local and are rendered
conditionally — no extraction needed unless the logged-in strip wants to
reuse them across files (then move to `src/components/landing/`).

- **Hero data**: derive the soonest open show from the existing
  `listOpenShows(db)` (pick the nearest future date) or add a thin
  `getSoonestOpenShow` repo helper; present via a new
  `presentLandingHero` presenter. Evergreen fallback when the list is
  empty.
- **Logged-in fan data**: the soonest-show-with-offer-status shape
  overlaps the Dashboard's `loadDashboardData`. The Dashboard already
  carries a "FUTURE CLEANUP: extract the loading logic into a shared
  helper" note — this is the second consumer, so extract
  `src/lib/home/load.ts` (or `dashboard/load.ts`) and share it rather
  than triple-duplicating the GET /api/shows loader.
- **Presenter layer**: all formatting (dates, prices) stays in
  `src/lib/presenters/` — repos return raw shapes, the page calls
  presenters (house rule). No formatting in the page or repos.

---

## Verification

- Logged-out `/`: full marketing renders; hero shows the real next show
  (seed one) or the evergreen fallback (no open shows); the "See a show"
  CTA no longer dead-ends.
- Logged-in as each role (fan / artist / admin): personalized section
  renders the right links and the right next-show status; marketing strip
  is the trimmed version.
- Rendering needs real Clerk test keys (CLAUDE.md gotcha); dev on :3001.
- e2e: a Playwright check that `/` while signed in shows the welcome band
  (not the "Create an account" CTA), and while signed out shows the
  marketing hero. `npm run test:e2e`.

---

## Risk notes

- **Auth posture**: surfacing real show data on a public page is the one
  security-relevant change — confirm intent (open decision above) before
  wiring real data into the logged-out hero.
- **Copy accuracy outranks layout**: the unverified fee/payout/timing
  claims are a trust issue on the most-visited page. Treat the copy
  review as a blocker for the logged-out slice, separate from the code.
- Coordinate with [`MOBILE_RESPONSIVE_PLAN.md`](MOBILE_RESPONSIVE_PLAN.md)
  Slice 2 (landing responsiveness) — both touch `page.tsx`. Do the
  content/auth rework first, then the responsive pass, to avoid
  re-working the same JSX twice.
