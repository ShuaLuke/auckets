// Pure seat-map generator for the inline "create venue" path in ShowCreate.
//
// Turns a compact tier spec (how many rows, how many seats per row, per
// tier) into the VenueRow[] the GAE consumes. This is the simple-generator
// scope: it does NOT replace the post-beta VenueBuilder (per-row sections,
// parity, lean, holds). It produces a uniform, valid seat map good enough to
// stand up a venue and run an allocation.
//
// Pure, no I/O — same posture as src/lib/gae/. Lives here (not the route) so
// it's unit-testable and the row conventions have one source of truth.
//
// Row conventions matched to drizzle/seed.ts + the GAE (verified against
// src/lib/gae/launchpad.ts + waterfall.ts):
//   - rowRank: ascending integer from 1, globally ordered (1 = best seat).
//     Tiers are listed best-first, so the first tier's rows get the lowest
//     ranks. waterfall.ts infers tier ordering from each tier's min rowRank.
//   - parity: "EVEN" — metadata only today; no GAE code reads it.
//   - lean: "CENTER" for seated rows, "LEFT" for GA (launchpad forces LEFT
//     on isGa rows anyway; we set it to match).
//   - seatNumbers: "1".."N" for seated rows; "GA-r-s" for GA (kept unique
//     per row so a multi-row GA bucket has distinct ids).
//   - holds: [] — manifest/comp holds are layered on per-show, not here.

import type { VenueRow } from "@/lib/gae/types";

export type TierSpec = {
  // Tier label, e.g. "premium". Becomes the row's `tier` and must match a
  // key in the show's tierFloorsCents.
  name: string;
  // Number of rows in this tier (≥1).
  rowCount: number;
  // Seats in each row of this tier (≥1).
  seatsPerRow: number;
  // General-admission bucket (no assigned seats). Forces LEFT placement.
  isGa: boolean;
};

// 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", … — spreadsheet-style labels so a
// big seated venue never runs out of row names.
export function alphaLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

// Generate the full VenueRow[] for a venue from its ordered tier specs.
// Tiers are processed in array order (best tier first), assigning a global
// ascending rowRank across all rows.
export function generateArchitectureRows(tiers: TierSpec[]): VenueRow[] {
  const rows: VenueRow[] = [];
  let rowRank = 1;
  let seatedIndex = 0; // drives A/B/C… labels for seated rows only

  for (const tier of tiers) {
    for (let i = 0; i < tier.rowCount; i++) {
      const isGa = tier.isGa;
      const capacity = tier.seatsPerRow;
      const rowName = isGa
        ? tier.rowCount === 1
          ? "GA"
          : `GA-${i + 1}`
        : alphaLabel(seatedIndex++);
      const seatNumbers = isGa
        ? Array.from({ length: capacity }, (_, s) => `GA-${i + 1}-${s + 1}`)
        : Array.from({ length: capacity }, (_, s) => String(s + 1));

      rows.push({
        id: `row-${rowRank}`,
        area: isGa ? "ga" : "orchestra",
        section: isGa ? "ga" : "main",
        rowName,
        rowRank,
        capacity,
        parity: "EVEN",
        lean: isGa ? "LEFT" : "CENTER",
        seatNumbers,
        holds: [],
        tier: tier.name,
        isGa,
      });
      rowRank++;
    }
  }

  return rows;
}
