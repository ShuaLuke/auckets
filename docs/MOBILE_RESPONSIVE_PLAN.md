# Mobile responsive plan

Plan for making AUCKETS usable on phones. The app was ported from the
desktop prototype with no responsive design — of ~45 page/component
files, none use breakpoints. This is the cross-walk of what breaks and
how we fix it.

Written 2026-05-29. **✅ COMPLETED — all four slices shipped in #85 (mobile-responsive pass, Slices 1–4).** This doc is now historical: global viewport + iOS input-zoom fix + clamp() type, the responsive landing page, the fan core flow (show/dashboard/ticket grids), and the artist/admin pages + nav disclosure menu + modal widths all landed. Kept for the cross-walk reasoning. Pair with [`CONVENTIONS.md`](CONVENTIONS.md).

---

## TL;DR

The site is desktop-only. The Next.js default viewport tag is present
(so it isn't zoom-locked), but every layout is fixed-width. The core
fan flow — the Show detail page — **horizontally overflows any phone**
because its two columns are an inline `style` of `380px 1fr`, and the
380px column alone is wider than a 375px viewport.

Fix strategy is mechanical and low-risk: **mobile-first restore**.
Make the base (no-prefix) layout the mobile one, gate today's exact
values behind a breakpoint. Everything at/above that breakpoint renders
byte-identical to today — desktop is untouched, only small screens
change.

---

## Principles

1. **Mobile-first restore.** `grid-cols-3` → `grid-cols-1 md:grid-cols-3`.
   Desktop ≥ breakpoint is pixel-identical to current; only < breakpoint
   is new. This keeps "functionality identical" true for existing users.
2. **One breakpoint, mostly.** `md:` (768px) is the workhorse; `sm:`
   (640px) only for the 4-up stat grid; `lg:` (1024px) only for the
   Show-page two-column (see decisions). No bespoke breakpoints.
3. **Two mechanics, because the codebase mixes Tailwind and inline `style`:**
   - Tailwind-class layouts (`grid-cols-N`, `px-8`) → responsive prefixes.
   - Inline-`style` fixed pixels (can't take media queries) → either
     converted to responsive Tailwind arbitrary values when
     layout-critical (`md:grid-cols-[380px_1fr]`), or wrapped in `min()`
     when they can stay inline (modal widths).
4. **No new shared components.** A `<PageContainer>` would be cleaner
   long-term but touches every page and risks colliding with parallel
   work. Keep every change additive and file-local. Extract later if it
   earns its place (3+ uses).

---

## Decisions (locked)

- **Show-page two-column collapses at `lg:` (1024px), not `md:`.**
  Stacking through tablet portrait is the safer read; 380px composer +
  venue map is cramped at 768px.
- **SiteNav gets a `<details>`-based disclosure menu** below `md:`,
  not a plain wrap. Keeps SiteNav a Server Component (no client JS),
  which the auth-gated role links depend on.
- **iOS input-zoom fix is in scope** (deviation from "identical"): form
  controls render at 13px, which makes mobile Safari auto-zoom on focus
  and not zoom back. Force ≥16px on inputs below `md:`. Minor visual
  change, large UX win.

Deferred / optional:
- **Sticky "Submit offer" CTA** on the mobile Show page (composer is a
  long scroll above the submit once stacked). Standard pattern; flagged
  as a follow-up, not in the core slices.

---

## Slices

Each touches a disjoint set of files, so they can be reordered around
other in-flight work. Branch names follow the house `feat/slice-N-...`.

### Slice 1 — Global foundations
Low risk, unblocks the rest.
- Confirm/explicitly export the viewport in [`src/app/layout.tsx`](../src/app/layout.tsx).
- iOS input-zoom fix in [`src/app/design-system.css`](../src/app/design-system.css):
  `@media (max-width: 767px) { input, select, textarea { font-size: 16px } }`.
- Convert `h1`/`h2`/`h3` `font-size` to `clamp()` in design-system.css
  (`.display-1` already does). Polish — rem headings wrap rather than
  overflow, so this is optional within the slice.

### Slice 2 — Landing page
File: [`src/app/page.tsx`](../src/app/page.tsx)
- Hero (L48): `flex items-end gap-16` → `flex flex-col md:flex-row md:items-end gap-10 md:gap-16`.
- Hero padding (L47) `"88px 32px 56px"` → responsive (`px-5 pt-14 pb-12 md:px-8 md:pt-[88px] md:pb-14`).
- How it works (L226): `grid-cols-3` → `grid-cols-1 md:grid-cols-3`.
- Comparison band (L278): `grid-cols-2` → `grid-cols-1 md:grid-cols-2`.
- For artists (L341): inline `gridTemplateColumns: "1.2fr 1fr"` →
  `grid-cols-1 md:grid-cols-[1.2fr_1fr]`; reduce `gap-14` on mobile;
  `fontSize: 44` heading → `text-3xl md:text-[44px]`.
- Reduce horizontal padding (32px → ~20px) on the remaining sections.

### Slice 3 — Fan core flow (highest priority)
- **Show detail** [`src/app/(fan)/shows/[showId]/page.tsx`](../src/app/(fan)/shows/[showId]/page.tsx)
  L184: inline `gridTemplateColumns: "380px 1fr"` →
  `grid-cols-1 lg:grid-cols-[380px_1fr]`. L178 `px-8` → `px-4 md:px-8`.
- **Dashboard** / **My-bids**: `px-8` → `px-4 md:px-8`. Audit
  [`ShowRow`](../src/components/dashboard/ShowRow.tsx) and
  [`BidCard`](../src/components/bids/BidCard.tsx) — fixed `width: 64`
  thumbnails + a `minWidth: 130` cell need to wrap / drop on mobile.
- **TicketViewer** [`src/components/ticket/TicketViewer.tsx`](../src/components/ticket/TicketViewer.tsx)
  L305: inline `gridTemplateColumns: "repeat(2, 1fr)"` and `minWidth: 140`
  → stack on mobile. This is the at-the-door QR screen; it must be clean
  on a phone.

### Slice 4 — Artist / Admin + nav + modals
- Grids → `grid-cols-1 md:grid-cols-N` (`grid-cols-2 sm:grid-cols-4` for
  [`SnapshotStats`](../src/components/artist/SnapshotStats.tsx)):
  [`RankBoard`](../src/components/show/RankBoard.tsx),
  [`TierBreakdownCard`](../src/components/artist/TierBreakdownCard.tsx),
  [`BigStatsCard`](../src/components/artist/BigStatsCard.tsx),
  [`AdminShowRow`](../src/components/admin/AdminShowRow.tsx),
  [`ArtistShowRow`](../src/components/artist/ArtistShowRow.tsx),
  [`ShowAdminTabs`](../src/components/artist/ShowAdminTabs.tsx).
- Modals → `width: 560` becomes `width: "min(560px, calc(100vw - 32px))"`
  (height capping already correct, stays inline, zero desktop change):
  [`AddHoldButton`](../src/components/artist/AddHoldButton.tsx) (560),
  [`BindingAllocationButton`](../src/components/artist/BindingAllocationButton.tsx) (520),
  [`RequestActionButton`](../src/components/artist/RequestActionButton.tsx) (540),
  [`PreviewAllocationButton`](../src/components/artist/PreviewAllocationButton.tsx) (480).
- Page padding `px-8` → `px-4 md:px-8` on the 4 artist/admin pages.
- SiteNav disclosure menu (see decisions).

---

## Verification

- Manual pass at 375px (iPhone SE), 390px (iPhone 13/14), 360px (Android)
  — the three widths the 380px column breaks today. Dev server on **:3001**;
  rendering needs real Clerk test keys (see CLAUDE.md gotchas).
- One Playwright e2e at a mobile viewport (`devices['iPhone 13']`)
  asserting no horizontal overflow
  (`document.documentElement.scrollWidth <= window.innerWidth`) on `/`,
  `/dashboard`, and a show page. Runs via `npm run test:e2e`.
- Existing CI (typecheck + lint + build) covers regressions — no type
  surface changes expected.

---

## Risk notes

- The pervasive inline `style` (vs Tailwind classes) is the main friction:
  layout-critical inline pixels must be converted to classes to become
  responsive, and each conversion must preserve the exact desktop value.
- Conflict risk with parallel work is lowest on Slice 1 and the Slice 4
  modal fix (small, localized). Slices 2–3 touch high-traffic page files.
