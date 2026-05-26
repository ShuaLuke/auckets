# Auckets Design System

> **Need to ship this to Claude Code?** → Start at
> [`handoff/TECHNICAL_INTEGRATION.md`](./handoff/TECHNICAL_INTEGRATION.md).
> It maps every prototype screen to a target file, defines the database
> schema, lists every API endpoint, integrates Stripe / TOTP / Twilio /
> Inngest, and flags design-side changes needed for deployment.
> The supporting [`handoff/README.md`](./handoff/README.md) covers the
> Tailwind/CSS install steps.

A working design system for **Auckets** — a dynamic ticket allocation
marketplace for live music. Fans submit offers (group size + price per
ticket). The Greenwood Allocation Engine ranks them and places groups
intelligently across the venue. It is explicitly *not* an auction.

This system extends the minimal foundations present in the codebase
(`ShuaLuke/auckets` at week-1 scaffold stage) into a complete brand
surface: type, color, spacing, components, and a fan-facing UI kit.

> **Source repo.** `https://github.com/ShuaLuke/auckets` —
> Next.js 14 + TypeScript + Postgres. The visual surface is a single
> hero page with an `AUCKETS` wordmark, a rounded-full primary CTA,
> and a 57px header with a neutral-200 border. Everything else here
> is *extension*, not recreation. Read `docs/CONTEXT.md` and
> `docs/GAE_SPEC.md` in that repo to deepen your understanding of
> the product before designing for it.

---

## Sources used

| What | Where | How it shaped the system |
|---|---|---|
| `ShuaLuke/auckets` README, CLAUDE.md, docs/CONTEXT.md | the repo | Product positioning, voice, tech stack, audience |
| `ShuaLuke/auckets` src/app/{layout,page}.tsx | the repo | Existing visual primitives (wordmark, pills, header) |
| `ShuaLuke/auckets` docs/GAE_SPEC.md | the repo | Data shapes for offer composer, status semantics |
| `ShuaLuke/auckets` docs/CONVENTIONS.md | the repo | Naming, voice, what *not* to do |

No Figma file, no slide deck, no logo asset, and no icon set were
provided by the repo. All visual choices below were extrapolated from
the codebase's tiny existing surface (warm neutrals, rounded-full
buttons, tracking-tight type, all-caps wordmark) plus thematic cues
from the product (Greenwood Allocation Engine → forest green;
live-music posters → marquee amber; tickets → stub motif).

---

## Visual foundations

### Color

A restrained, warm-toned palette built around a single brand accent.
The codebase's neutrals lean warm (`neutral-900` against white), and
we lean into that — black is `#0E0F0C` with a slight yellow cast, and
the base surface is a warm cream rather than pure white.

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#0E0F0C` | Primary text, primary button bg, header rule |
| `--ink-500` | `#46443B` | Secondary text |
| `--ink-300` | `#9C9789` | Tertiary, captions |
| `--paper`   | `#F4F1E8` | App background — warm cream |
| `--page`    | `#FFFFFF` | Card / primary surface |
| `--greenwood-600` | `#1F4A2E` | **Brand accent** — references the GAE |
| `--marquee-500`   | `#C99A4B` | Secondary accent — stage-light amber |
| `--brick-500`     | `#A93C2A` | Alert / unplaced status |

Full scales in [`colors_and_type.css`](./colors_and_type.css). Semantic
tokens (`--bg`, `--fg`, `--border`, `--brand`, `--status-placed`,
`--status-unplaced`, etc.) are defined alongside.

### Type

Three families, all variable. **Note the substitutions** — see
"Caveats" below.

| Role | Family | Notes |
|---|---|---|
| Display | **Bricolage Grotesque** | Variable, opsz axis. For hero, headlines, the wordmark. |
| UI / body | **Geist** | Fits the Next.js/Vercel context. Replaces the system sans the codebase currently inherits. |
| Numeric / mono | **JetBrains Mono** | Prices, rank keys, allocation log lines, seat refs. Tabular nums. |

The wordmark is always uppercase, tracked to `-0.03em`, opsz 96 at
hero sizes. Body letter-spacing is `-0.015em` to match the
`tracking-tight` class the codebase uses.

### Spacing & radii

4pt scale. `--radius-pill` (999px) for buttons matches the codebase
(`rounded-full`); cards use `--radius-md` (8px) or `--radius-lg`
(12px); inputs use `--radius-md`. The marquee CTA variant breaks the
rule on purpose — rounded-md with a hard `4px 4px 0 0` offset shadow,
poster-style, for hero moments only.

### Elevation

Flat by default. Cards have a 1px `--border` only. Three shadow tiers
are defined (`sm`, `md`, `lg`) for popovers / menus / dialogs
respectively, plus one bespoke `--shadow-marquee` for the poster
moments. **Auckets is a paper-flat design language** — if a surface
needs a shadow to be legible, look at hierarchy first.

### Animation

Conservative. 120ms `ease-out` for hover; 180ms for state changes;
320ms reserved for entrances. **No bouncy springs in the product
surface** — the only "snap" easing token is reserved for the
in-prototype demo controls. Anti-FOMO: never animate a countdown.

### Backgrounds, imagery, transparency

- **Backgrounds are flat color, almost always `--paper` or `--page`.**
  No gradient walls, no image hero washes.
- The **ticket-stub motif** (rounded rect + perforation dots + dashed
  divider) is the one repeatable graphic device. Used for hero cards,
  offer receipts, and the brand mark.
- **No transparency or blur** in production UI. The dialog scrim is
  the one exception (`rgba(14,15,12,.4)`).
- **No grain, no halftone, no hand-drawn illustration** unless the
  team explicitly commissions it. Don't ad-lib it.

### Borders

`1px solid var(--border)` is the default — `rgba(14,15,12,.12)`. The
"poster" variant uses `1px solid var(--ink-900)` for high contrast.
Avoid double borders; lean on the `--shadow-flat` token if you need a
border-equivalent on a colored surface.

### Hover & press states

- **Hover** on filled buttons: shift to the next-darker shade
  (e.g. `--ink-900` → `--ink-600`).
- **Hover** on outlined buttons: fill to `--ink-50` / `--paper`.
- **Hover** on rows / list items: `--shadow-sm` lift only (no color).
- **Press** on the Marquee CTA: shift `translate(2px, 2px)` and shrink
  the offset shadow from `4px` to `2px`. Tactile, no color change.
- No opacity-based hover except on `<a>` (drops to `0.6`).

### Layout

- App container max widths: narrow `640`, base `960`, wide `1200`,
  full `1440`.
- Header is **57px** and sticky.
- The fan dashboard uses 960; the show / composer screen uses 1100
  with a 380px composer sidebar.

---

## Content fundamentals

### Voice

**Matter-of-fact. Plain English. Anti-FOMO.** Auckets's positioning
*is* its tone — the whole product exists because the previous build
("HFC") leaned hard on auction tropes and the team rejected them.

The voice rules pulled from `docs/CONTEXT.md` and CLAUDE.md:

- Prefer plain English over jargon.
- Surface options before locking in choices.
- Never assume past an open question.
- Honest about tradeoffs.

### Casing

- Wordmark: **all caps** (`AUCKETS`).
- Section headers, page titles: **sentence case** (`Submit your offer`,
  not `Submit Your Offer`).
- Eyebrow labels: **UPPERCASE with `0.16em` tracking** (`A FAIRER WAY
  TO SEAT A ROOM`).
- Button labels: **sentence case, no period** (`Create an account`).

### Pronouns

- **You** to the fan: *"Front row, fair price."* / *"You're in the room."*
- **We** when speaking as Auckets: *"We've authorized your card but
  haven't charged it."* / *"We'll email you the moment it does."*
- Never refer to the engine by its full name in fan-facing copy.
  Internal docs say "GAE"; users see "we" or "allocation".

### Things we don't say

- "Hurry!" / "Only X left!" / "Going fast!" — FOMO copy.
- "Bid" / "win" / "outbid" — it's not an auction.
- "Time-sensitive!" — checkpoints are announced and predictable.
- Stacked exclamation points. Ever.

### Example pairs (do / don't)

| Don't | Do |
|---|---|
| Don't miss out — bid now! | Submit one offer. Edit it up until allocation. |
| You won the auction! | You're in the room. Allocation runs in 23h 14m. |
| 47 people are watching this show right now! | 142 offers in the pool. Median offer $28. |
| Pay $42 + $4 service fee = $46 | $42 per ticket. No hidden fees. |

### Emoji

**No.** None in product surfaces, none in marketing, none in emails.
The vocabulary is built from words and the ticket-stub mark; emoji
would clash with the anti-FOMO restraint and the warmth of the type.

### Numbers, money, seats

- Money: **integer dollars and cents** (`$42.00`, not `$42`). Always
  mono. Always tabular-nums.
- Seat numbers: mono (`Row AA · seats 7–10`).
- Group size: written as `× 4 tickets` (no "x"; the math sign).
- Rank keys are user-visible in the receipt and dashboard, formatted
  as a bare integer in `<Tag>` style.

---

## Iconography

**The Auckets codebase ships no icons of its own** (the existing pages
use no icons at all; the only graphic is the text wordmark).

For this system we use **Lucide** loaded from CDN
(`unpkg.com/lucide@0.469.0/dist/umd/lucide.min.js`). Lucide was
chosen because its stroke weight (1.75px), squared-but-rounded
terminals, and restrained set match the design language — minimal,
warm, no decorative flourish. **This is a SUBSTITUTION, flagged for
the team**; if Auckets wants a custom icon set later, the seam is
`ui_kits/auckets/components/Icon.jsx` (one component to swap).

Used icons (today): `ticket`, `calendar`, `arrow-right`, `arrow-left`,
`chevron-right`, `check`, `x`, `plus`, `minus`, `mail`, `apple`,
`map-pin`. Add to the kit by referencing them by name — Lucide
resolves at render time.

**Unicode characters used as icons.** Currently: `×` (multiplication
sign) for group-size expressions (`× 4 tickets`). And `→` / `←` in
hero CTAs. Avoid arbitrary unicode glyphs in body copy.

**Emoji.** Never.

**Brand mark.** `assets/logo-mark.svg` (and `-greenwood.svg`) — a
ticket stub with perforation dots and the letter `A`. Use at favicon
and avatar sizes; prefer the wordmark everywhere else.
`assets/logo-wordmark.svg` and `-inverse.svg` cover light and dark
surfaces.

---

## Index

### Foundations
- [`colors_and_type.css`](./colors_and_type.css) — every token,
  semantic mappings, base typography classes.
- [`assets/logo-wordmark.svg`](./assets/logo-wordmark.svg),
  [`logo-wordmark-inverse.svg`](./assets/logo-wordmark-inverse.svg) —
  text wordmark, on light and dark.
- [`assets/logo-mark.svg`](./assets/logo-mark.svg),
  [`logo-mark-greenwood.svg`](./assets/logo-mark-greenwood.svg) —
  ticket-stub mark for small sizes.

### Previews (Design System tab cards)
- `preview/brand-*.html` — wordmark, mark, voice
- `preview/colors-*.html` — greenwood, ink, accents, surfaces, status
- `preview/type-*.html` — display, headings, body, utility
- `preview/spacing-*.html` — scale, radii, elevation
- `preview/components-*.html` — buttons, fields, badges, cards,
  seat-block visualization

### UI Kit
- [`ui_kits/auckets/`](./ui_kits/auckets/README.md) — fan-side
  click-thru prototype: landing, sign-up modal, dashboard, show /
  offer composer, allocation result.

### Skill
- [`SKILL.md`](./SKILL.md) — entry point if this design system is
  loaded as an Agent Skill.

---

## Caveats — please confirm

These are things I had to extrapolate without source-of-truth from
the codebase. **Flag any you want changed and I'll iterate.**

1. **Fonts are substituted.** Bricolage Grotesque, Geist, and
   JetBrains Mono are loaded from Google Fonts. The codebase doesn't
   ship fonts. If Auckets has licensed display faces (e.g. Söhne,
   Tasa, or a commissioned wordmark face), drop them into `fonts/`
   and update the `--font-display` / `--font-sans` / `--font-mono`
   CSS variables.
2. **No real logo exists.** I rendered the wordmark as text-set
   Bricolage Grotesque and drew a placeholder ticket-stub mark.
   Replace with the real logo when it lands.
3. **Greenwood green and Marquee amber are inferred.** The codebase
   has only neutral-900 and white in use. Greenwood (`#1F4A2E`)
   directly references the *Greenwood* Allocation Engine — a literal
   tie to the artist (Citizen Cope is Clarence Greenwood) and the
   engine. If Auckets prefers no brand color (pure black / white /
   warm cream), this is easy to walk back.
4. **Lucide icons are a substitute.** No native icon set exists in
   the codebase. Swap by replacing `Icon.jsx`.
5. **Lincoln Theatre venue data is synthetic.** Three tiers, 14 rows,
   generic seat numbering. Will swap to real manifest data per
   `docs/CONTEXT.md` once Cope sends it.
6. **Artist and admin dashboards are not prototyped** — the UI kit is
   fan-side only. Per the roadmap these are Weeks 4–6 work; I can
   sketch them next if useful.
7. **No production emails, transactional copy, or notification
   templates** in this system yet. Adding them is straightforward
   once we know the channel mix (email + SMS) and the voice for
   transactional vs. promotional sends.

---

## Strong ask

**Help me make this perfect.** Specifically I'd love:

- A **logo direction** — even a rough sketch — so I can replace the
  placeholder wordmark and mark with the real thing.
- A **font confirmation** — is Bricolage Grotesque the right
  personality, or should we go more classical (Söhne / Tasa) /
  more poster-y (Druk / Recoleta) / more system-clean (Geist alone)?
- A take on the **Greenwood green** — keep it, drop it, or shift it?
- Whether to **sketch the artist and admin surfaces** next, or stay
  fan-side and refine.

Then I'll iterate.
