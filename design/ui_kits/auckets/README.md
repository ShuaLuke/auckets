# Auckets — UI Kit (Fan App)

A click-thru prototype of the fan-facing surface of AUCKETS. Recreates
the Next.js app from `ShuaLuke/auckets` at week-1 fidelity and extends
it forward to demonstrate the core flow:

  Landing → Sign up → Dashboard → Show / Offer composer → Allocation

## Why this exists

The codebase at `ShuaLuke/auckets` is still in foundation-stage. The
hero page renders only an `AUCKETS` wordmark, a primary CTA, and a
neutral-200 header. Everything else — the offer composer, the venue
preview, the allocation result, the dashboard — lives in the spec
(`docs/CONTEXT.md`, `docs/GAE_SPEC.md`) but has no UI yet.

This kit is a high-fidelity sketch of how those screens *could* look,
strictly within the design foundations defined at the project root
(`colors_and_type.css`, the `preview/` cards). It is intentionally
non-functional — all state is local to the React tree.

## Files

```
ui_kits/auckets/
├── index.html              ← entry; loads scripts in order
├── App.jsx                 ← state machine (landing/dashboard/show/allocation)
├── components/
│   ├── Icon.jsx            ← Lucide wrapper (CDN substitute — flagged)
│   ├── Buttons.jsx         ← Button, MarqueeButton, IconButton
│   ├── Header.jsx          ← matches src/app/layout.tsx
│   ├── Fields.jsx          ← Field, TextInput, Stepper, RadioGroup
│   └── Surfaces.jsx        ← Badge, Tag, Card, Eyebrow
└── screens/
    ├── Landing.jsx         ← hero + how-it-works + compare
    ├── SignUpModal.jsx     ← stand-in for Clerk modal
    ├── Dashboard.jsx       ← "My shows" list (3 sample shows)
    ├── Show.jsx            ← offer composer + venue preview + rank board
    └── Allocation.jsx      ← post-submit confirmation (ticket-stub receipt)
```

## Running

It's a single-file static prototype. Open `index.html` in a browser.
React, ReactDOM, and Babel are pinned to the versions specified in the
project's design conventions; Lucide loads from `unpkg`.

## Faithfulness notes

- The header matches the live layout (57px, neutral-200 border, pill sign-up).
- Voice on Landing pulls directly from `docs/CONTEXT.md`:
  "not an auction", "no countdown timer", "no per-ticket bidding war".
- Offer composer follows the data model in `docs/GAE_SPEC.md` —
  `RankedOffer.{groupSize, pricePerTicketCents, tierPreference}` with
  the three documented `TierPreference` types as the radio options.
- Rank key uses the documented formula `(price * 100) * 1000 + groupSize`.
- Status colors map 1:1 to allocation decisions: PLACED / PENDING /
  SKIPPED / UNPLACED.

## Known omissions

- Artist and admin dashboards (Weeks 4–6 in the roadmap) — not
  prototyped. The kit is fan-side only.
- Real Clerk auth modal — substituted with a static modal.
- Stripe payment surface — out of scope at this stage.
- Real venue manifest — Lincoln Theatre is sketched with synthetic
  data (3 tiers, 14 rows, generic seat layout).
