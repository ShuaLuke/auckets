# Handoff — Auckets Design System → `ShuaLuke/auckets`

> **For technical integration** (database schema, API endpoints,
> Stripe + TOTP + GAE + Inngest, screen → file map, deployment flags):
> **read [`TECHNICAL_INTEGRATION.md`](./TECHNICAL_INTEGRATION.md) first.**
> That document is the authoritative spec. This file is the
> visual-layer handoff only.

This is the bridge document for a Claude Code session working on the
actual Auckets repo (Next.js 14, App Router, Tailwind, Drizzle, Clerk,
per [`docs/CONTEXT.md`](https://github.com/ShuaLuke/auckets/blob/main/docs/CONTEXT.md)).

The HTML / JSX files at the root of this design system project are
**design references** — prototypes showing intended look and behavior.
They are NOT production code to drop in. Your job is to recreate them
as real React Server Components and Client Components inside the
existing `src/app/` route groups, using the codebase's pinned stack
(React 18.3.1, Tailwind 3.4, Lucide-react, etc.) and its conventions
([`docs/CONVENTIONS.md`](https://github.com/ShuaLuke/auckets/blob/main/docs/CONVENTIONS.md)).

## Fidelity

**High-fidelity.** Colors, type, spacing, radii, and copy are final.
Match the prototypes pixel-for-pixel where it makes sense. Where this
document and a prototype disagree, **this document wins** — prototypes
were a tool to test the system, not the spec.

---

## 1. Foundation install (one-time)

### 1a. Tokens — Tailwind

Replace `tailwind.config.ts` with the contents of
[`tailwind.config.additions.ts`](./tailwind.config.additions.ts). This
extends Tailwind with the full Auckets token set (`text-fg`, `bg-paper`,
`text-ink-900`, `bg-greenwood-600`, etc.) and adds the three font
families as CSS variables.

### 1b. Global CSS

Replace `src/app/globals.css` with [`globals.css`](./globals.css). This:
- Pulls Bricolage Grotesque, Geist, and JetBrains Mono from Google Fonts.
- Defines every `--*` variable from `colors_and_type.css`.
- Sets `body` defaults (font, antialiasing, warm paper background).
- Adds the typography utility classes (`.wordmark`, `.eyebrow`, `.mono`, `.numeric`).

### 1c. Fonts caveat

The three webfonts are loaded from Google Fonts. **If Auckets has
licensed display faces** (Söhne, Tasa, or a commissioned wordmark
face), drop them into `src/fonts/` and replace the `@import` line in
`globals.css` with `@font-face` declarations. Then update the
`--font-display`, `--font-sans`, `--font-mono` variables.

### 1d. Icons

Install Lucide React: `npm install lucide-react@0.469.0`. Import icons
by name (`import { Ticket, Calendar, ChevronRight } from 'lucide-react'`).
Use `strokeWidth={1.75}` and the appropriate `size` prop per the
prototypes.

---

## 2. Component library — `src/components/ui/`

Build these as small, reusable components. Keep them stateless and
prop-driven. Mark them `'use client'` only where they need hover or
state (Button, Stepper, RadioGroup, Header menu). Reference files are
in the design system at `ui_kits/auckets/components/`.

| Component                   | Variants                                                  | Reference |
|---|---|---|
| `Button`                    | `primary`, `brand`, `secondary`, `ghost`, `inverse`; `sm`/`md`/`lg`; optional `icon`/`iconAfter` | `Buttons.jsx` |
| `MarqueeButton`             | The poster-style CTA — hard offset shadow, square radius. Used for hero moments. | `Buttons.jsx` |
| `IconButton`                | Round icon button; ghost background, hover lift          | `Buttons.jsx` |
| `Field`                     | Label + child input + optional hint                      | `Fields.jsx`  |
| `TextInput`                 | With optional `prefix`/`suffix`, `mono` flag             | `Fields.jsx`  |
| `Stepper`                   | Pill stepper for group size (1–8)                        | `Fields.jsx`  |
| `RadioGroup`                | Vertical, card-style options with optional `hint`        | `Fields.jsx`  |
| `Segmented`                 | Horizontal pill picker for tier / parity / lean           | `VenueBuilder.jsx` |
| `Badge`                     | Tones: `placed`, `preview`, `pending`, `skipped`, `unplaced`, `open`, `upcoming`, `inverse` | `Surfaces.jsx` |
| `Tag`                       | Mono code-style chip for IDs and tier names              | `Surfaces.jsx` |
| `Card`                      | Variants: `default`, `warm`, `sunken`, `inverse`, `outline` | `Surfaces.jsx` |
| `Eyebrow`                   | Tiny uppercase label                                      | `Surfaces.jsx` |
| `Header`                    | 57px sticky with optional role pill                       | `Header.jsx`  |
| `SignUpModal`               | Auth modal (substitute for Clerk's hosted UI)             | `SignUpModal.jsx` |

---

## 3. Screens — map to App Router

The repo already has the route group skeleton: `(fan)`, `(artist)`,
`(admin)`. Implement these screens against those.

### 3a. Marketing — `src/app/page.tsx`

Replace the placeholder hero with the **expanded Landing** in
`ui_kits/auckets/screens/Landing.jsx`. Sections in order:
1. Hero (left: eyebrow, display-1 H1, body, MarqueeButton + ghost). Right: a `HeroTicketCard`.
2. "How it works" — 3 numbered steps.
3. Comparison band — Not this / This instead.
4. **For artists** — inverse (`#0E0F0C`) section with a mock allocation log.
5. **FAQ** — `<details>` accordions, 6 questions sourced from `docs/CONTEXT.md` and `docs/OPEN_QUESTIONS.md`.
6. Footer — inverse, wordmark + tagline.

### 3b. Fan dashboard — `src/app/(fan)/dashboard/page.tsx`

Replace the current placeholder with the show list in
`ui_kits/auckets/screens/Dashboard.jsx`. Server component; fetch shows
the user has offered on + open shows. Each row is a client `<ShowRow>`
that handles hover state.

### 3c. Fan offer composer — `src/app/(fan)/shows/[showId]/page.tsx` (NEW)

This is the meatiest screen. See `ui_kits/auckets/screens/Show.jsx`.
- Left: 380px sticky composer card (group-size stepper, price field
  with `$` prefix, tier-preference radio group, rank-key tag, submit).
- Right: live preview banner (inverse Card), venue preview, rank board
  (3-up Stat grid).
- Submit posts to `POST /api/offers` (per `docs/CONVENTIONS.md` route
  template) with Zod-validated body: `{ showId, groupSize, pricePerTicketCents, tierPreference }`.
- The "preview" math (`computePreview` in `Show.jsx`) is **synthetic
  for the prototype**. In production, this comes from running the GAE
  in preview mode against current pool state.

### 3d. Fan allocation preview — `src/app/(fan)/shows/[showId]/offer/page.tsx` (NEW)

See `ui_kits/auckets/screens/Allocation.jsx`. Shown after submit,
before binding. Big ticket-stub receipt + "What happens next" timeline.
Pulls the offer + provisional placement from the DB.

### 3e. Fan final result — `src/app/(fan)/shows/[showId]/result/page.tsx` (NEW)

See `ui_kits/auckets/screens/AllocationFinal.jsx`. Two variants
(`outcome="placed"` / `"not-placed"`) — branch on whether a
`seat_assignments` row exists for this offer + user.

### 3f. Artist dashboard — `src/app/(artist)/page.tsx` (NEW)

See `ui_kits/auckets/screens/ArtistDashboard.jsx`. Snapshot stats +
show rows with capacity progress bar.

### 3g. Artist show admin — `src/app/(artist)/shows/[showId]/page.tsx` (NEW)

See `ui_kits/auckets/screens/ShowAdmin.jsx`. **The most complex
screen.** Four tabs:
- **Overview** — aggregate stats, recent activity (read from
  `allocation_logs`), tier floor cards.
- **Distribution** — histogram of offer prices.
- **Provisional placement** — full venue map with placement coloring.
- **Holds & manifest** — list of holds, mutable for artist holds,
  read-only for venue/ADA holds.
- "Preview allocation" button opens a confirm dialog that runs the GAE
  in `mode: 'preview'`.

### 3h. Artist create show — `src/app/(artist)/shows/new/page.tsx` (NEW)

See `ui_kits/auckets/screens/ShowCreate.jsx`. Three-step single-page
form: venue + date, offer window length, tier floors.

### 3i. Admin venue builder — `src/app/(admin)/venues/[venueId]/page.tsx` (NEW)

See `ui_kits/auckets/screens/VenueBuilder.jsx`. Two-pane editor:
- Left: scrollable row list with inline tier/lean/cap.
- Right: sticky row editor with Segmented controls + live JSON preview.

Per `docs/CONTEXT.md` Q23/Q24, this is the **first-3-venues manual
build** tool. The output writes to the `venue_architectures` table.

---

## 4. Email templates

The codebase uses `@react-email/components` already (`package.json`).
The five templates in `/emails/` are static HTML — port them to React
Email components under `src/lib/email/templates/`:

| Template                      | File                    | Trigger                       |
|---|---|---|
| Welcome                       | `welcome.tsx`            | Clerk user.created webhook    |
| Offer received                | `offer-received.tsx`     | After `POST /api/offers` 200  |
| Allocation imminent           | `allocation-imminent.tsx`| Inngest cron, T−1h            |
| Placed                        | `placed.tsx`             | After binding allocation, per offer with assignment |
| Not placed                    | `not-placed.tsx`         | After binding allocation, per offer without assignment |

Each shares a wrapper component (header logo + footer with
unsubscribe). Copy strings exactly from the HTML — the voice is final.

---

## 5. Design tokens (canonical)

The complete token set is in [`colors_and_type.css`](../colors_and_type.css).
The most-used values:

### Colors
```
--ink-900        #0E0F0C   primary text, primary button bg
--ink-500        #46443B   secondary text
--ink-300        #9C9789   tertiary, captions
--paper          #F4F1E8   app background (warm cream)
--page           #FFFFFF   card / primary surface
--greenwood-600  #1F4A2E   brand accent (PRIMARY)
--marquee-500   #C99A4B    secondary accent (stage amber)
--brick-500      #A93C2A   alert / unplaced
```

### Status (allocation outcomes)
```
PLACED    bg #EEF3EE  fg #163823  dot #1F4A2E
PENDING   bg #F6E6CC  fg #8F6A2A  dot #C99A4B
SKIPPED   bg #E8E6DE  fg #46443B  dot #6B6759
UNPLACED  bg #F2D9D3  fg #722417  dot #A93C2A
```

### Type
```
Display   Bricolage Grotesque, weight 600–700, opsz 32–96, tr -0.025–-0.04em
Sans (UI) Geist, weight 400–600, tr -0.015em
Mono       JetBrains Mono, tabular-nums for prices/IDs/seats
```

### Spacing — 4pt scale (`--space-1` through `--space-10`)
```
4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128
```

### Radii
```
xs 2 · sm 4 · md 8 · lg 12 · xl 20 · pill 999
```

### Shadows
Flat by default. Use `--shadow-sm` for hover lifts; `--shadow-md` for
popovers/menus; `--shadow-lg` for dialogs; `--shadow-marquee` (hard
offset) for the poster CTA only.

---

## 6. Behavioral spec

- **Hover** on filled buttons: shift one shade darker.
- **Hover** on rows / list items: add `--shadow-sm`, no color shift.
- **Press** on Marquee CTA: `translate(2px, 2px)` and shrink shadow from 4 → 2px.
- **Focus**: 3px Greenwood ring at 15% opacity (`box-shadow: 0 0 0 3px rgba(31,74,46,.15)`), Greenwood border.
- **Transitions**: 120ms `ease-out` for hover; 180ms for state changes.
- **No bouncy springs**; no fade-only entrances; no countdown animations.

---

## 7. Copy guidelines

Pulled from [`README.md` § Content Fundamentals](../README.md). The
short version:

- **Matter-of-fact, plain English, anti-FOMO.**
- **You** for the fan; **we** for Auckets.
- **No emoji. No exclamation points stacked. No "bid" / "win" / "hurry".**
- **Sentence case** for headers and buttons.
- **UPPERCASE 0.16em** for eyebrows.
- **All-caps `AUCKETS`** for the wordmark.
- **Money**: integer dollars and cents, mono, tabular-nums. `$42.00` not `$42`.

---

## 8. Asset references

| Asset | Path | Use |
|---|---|---|
| Wordmark              | `../assets/logo-wordmark.svg`           | Marketing, emails, large surfaces |
| Wordmark (inverse)    | `../assets/logo-wordmark-inverse.svg`   | Dark backgrounds                  |
| Brand mark            | `../assets/logo-mark.svg`               | Favicon, avatars, app icon        |
| Brand mark (greenwood)| `../assets/logo-mark-greenwood.svg`     | Branded badge sizes               |

All four are placeholders. Replace with the real logo when it lands.

---

## 9. What's NOT in this handoff

- Real venue manifest for Lincoln Theatre — Cope to provide.
- Real Stripe Connect / SetupIntent flows — out of scope of design.
- The actual GAE implementation — see `docs/GAE_SPEC.md`.
- Mobile breakpoints — not yet designed. Add when mobile is on the roadmap.

---

## 10. Suggested implementation order

For a Claude Code session, work in this order:

1. **Foundation** — paste `tailwind.config.additions.ts` and `globals.css`.
2. **Components library** — Button, Card, Field, TextInput, Badge, Eyebrow, Header.
3. **Marketing** — replace `src/app/page.tsx`.
4. **Fan flow** — Dashboard → Show → Allocation → AllocationFinal.
5. **Email templates** — port all 5 to React Email.
6. **Artist flow** — ArtistDashboard → ShowAdmin → ShowCreate.
7. **Admin** — VenueBuilder.

Each step is one PR per the repo's working norms. Don't skip the
testing pattern in `docs/CONVENTIONS.md` § Tests.
