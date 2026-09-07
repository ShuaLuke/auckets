// Presenter for the tier-band heat views of the live-preview map — the "Your
// spot" and "Demand" tabs (the heat-map redesign of the composer's centerpiece).
//
// Pure: groups the fan venue preview (sections of rows of seats) into PRICED
// tier bands and derives each band's current fill, so the map component stays
// dumb. Money/label formatting lives here, never in the component.
//
// VISUAL-ONLY, by design. There are no placement ODDS here: the odds engine
// (ADR-0020) doesn't exist yet, and the product's honesty rule forbids showing
// a likelihood we can't compute. So "Demand" is honest *current fill* and "Your
// spot" is the deterministic projected zone — never a fabricated percentage.

import type { FanRow, FanSection } from "./venue-preview";

export type TierBand = {
  tier: string;
  // Display label — "Premium", "GA" (matches the offers/standing presenters).
  label: string;
  // Whole-dollar floor for the band, e.g. "$140+". null when the show has no
  // floor recorded for this tier (a GA-only or mis-seeded show).
  floorDisplay: string | null;
  floorCents: number | null;
  rows: readonly FanRow[];
  totalSeats: number;
  // Seats already taken (other fans). The caller's own seats are excluded
  // upstream (baseSections drop them), so this is honest "demand from others".
  placedSeats: number;
  // placedSeats / totalSeats, clamped 0..1 (0 for an empty band).
  fillRatio: number;
};

// "premium" → "Premium"; "ga" stays "GA". Mirrors tierLabel in live-preview.ts
// so the band labels match the standing line.
function tierLabel(tier: string): string {
  if (tier.toLowerCase() === "ga") return "GA";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// Whole-dollar floor display — "$140+". formatCents keeps a ".00" we don't want
// on a band header, and floors are whole dollars in practice.
function floorDisplay(cents: number): string {
  const dollars = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}+`;
}

// Group the already-ordered sections (closest-to-stage first) into tier bands
// with per-band fill. Order is preserved from the input — the page builds
// `sections` front-to-back, and the map renders them top-to-bottom.
export function buildTierBands(
  sections: readonly FanSection[],
  tierFloorsCents: Record<string, number>,
): TierBand[] {
  return sections.map((section) => {
    let total = 0;
    let placed = 0;
    for (const row of section.rows) {
      for (const seat of row.seats) {
        total += 1;
        // "yours" can't appear in baseSections (the caller's own seats are
        // dropped upstream), but count it as filled defensively in case this
        // presenter is ever fed a self-inclusive preview.
        if (seat.status === "placed" || seat.status === "yours") placed += 1;
      }
    }
    const floorCents = tierFloorsCents[section.tier] ?? null;
    return {
      tier: section.tier,
      label: tierLabel(section.tier),
      floorDisplay: floorCents !== null ? floorDisplay(floorCents) : null,
      floorCents,
      rows: section.rows,
      totalSeats: total,
      placedSeats: placed,
      fillRatio: total > 0 ? placed / total : 0,
    };
  });
}
