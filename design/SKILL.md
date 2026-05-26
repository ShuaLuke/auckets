---
name: auckets-design
description: Use this skill to generate well-branded interfaces and assets for Auckets, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping the Auckets dynamic-ticket-allocation marketplace.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts *or* production code, depending on the need.

## Quick reference

- **Brand:** Auckets — fairness-first live-music ticket marketplace. Not an auction.
- **Voice:** Matter-of-fact, anti-FOMO, plain English. Say what it is.
- **Wordmark:** Always uppercase `AUCKETS`, Bricolage Grotesque 700, `-0.03em`.
- **Brand accent:** Greenwood green `#1F4A2E`.
- **Base surface:** Paper cream `#F4F1E8`. Ink near-black `#0E0F0C`.
- **Pills for buttons.** Subtle borders, no shadows by default.
- **No emoji. No countdown timers. No "bid".**

## Files

- `colors_and_type.css` — full token set + base typography classes.
- `assets/` — wordmark, ticket-stub mark, Greenwood variants.
- `preview/` — design-system review cards.
- `ui_kits/auckets/` — fan-facing click-thru React prototype with
  Landing, SignUpModal, Dashboard, Show/Offer composer, Allocation.

## Upstream

Read `docs/CONTEXT.md` and `docs/GAE_SPEC.md` at
`https://github.com/ShuaLuke/auckets` for product depth before
designing anything substantive — the product positioning is the
brand.
