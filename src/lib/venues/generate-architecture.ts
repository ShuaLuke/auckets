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

// What kind of seating unit a tier is built from. This drives the LABELS the
// generator produces (and the row's `area`), not — yet — how the GAE fills
// the unit. A "table" is currently filled seat-by-seat exactly like a row;
// atomic-table seating (a group takes the whole table, no strangers) is
// deferred GAE work — see docs/REMAINING_WORK.md "Atomic seating units".
//
//   rows    — classic theatre rows: A, B, C…           area "orchestra"
//   tables  — Table 1, Table 2…  (rowCount = #tables)   area "tables"
//   boxes   — Box 1, Box 2…      (rowCount = #boxes)    area "boxes"
//   ga      — one open standing/GA bucket, no seats     area "ga"
//   custom  — operator-named unit (e.g. "Lawn 1")       area = slug(label)
export type UnitType = "rows" | "tables" | "boxes" | "ga" | "custom";

export type TierSpec = {
  // Tier label, e.g. "premium". Becomes the row's `tier` and must match a
  // key in the show's tierFloorsCents.
  name: string;
  // Number of units in this tier (≥1): rows, tables, or boxes. GA is always
  // a single unit (the UI forces rowCount = 1 and folds capacity into one
  // "total capacity" field).
  rowCount: number;
  // Seats in each unit of this tier (≥1). For GA, the whole bucket capacity.
  seatsPerRow: number;
  // General-admission bucket (no assigned seats). Forces LEFT placement.
  // Kept for back-compat; `unitType: "ga"` is the canonical signal now and
  // either one marks the tier as GA.
  isGa: boolean;
  // The seating-unit kind. Optional for back-compat: when omitted we infer
  // "ga" from isGa, else "rows". `| undefined` is explicit so a Zod-inferred
  // body (which types optionals as `T | undefined`) assigns cleanly under
  // exactOptionalPropertyTypes.
  unitType?: UnitType | undefined;
  // Singular label for `unitType: "custom"`, e.g. "Lawn". Ignored otherwise.
  customLabel?: string | undefined;
};

// Resolve the effective unit type, tolerating older specs that only set isGa.
function resolveUnit(tier: TierSpec): UnitType {
  if (tier.unitType) return tier.unitType;
  return tier.isGa ? "ga" : "rows";
}

// lowercase, non-alphanumeric runs → "_", trimmed — turns a custom label
// like "VIP Lawn" into a stable `area` slug "vip_lawn". Falls back to
// "section" so the area is never empty.
function slugifyArea(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug === "" ? "section" : slug;
}

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
  let seatedIndex = 0; // drives A/B/C… labels for "rows" units only

  for (const tier of tiers) {
    const unit = resolveUnit(tier);
    const isGa = unit === "ga";

    // Per-unit area/section + a labeller for the unit at index i. Seat
    // numbers stay sequential ("1".."N") for every seated/table/box/custom
    // unit; GA keeps its unique "GA-r-s" ids so a multi-row bucket can't
    // collide. Only "rows" consumes the A/B/C sequence.
    let area: string;
    let section: string;
    let nameAt: (i: number) => string;
    switch (unit) {
      case "tables":
        area = "tables";
        section = "tables";
        nameAt = (i) => `Table ${i + 1}`;
        break;
      case "boxes":
        area = "boxes";
        section = "boxes";
        nameAt = (i) => `Box ${i + 1}`;
        break;
      case "ga":
        area = "ga";
        section = "ga";
        nameAt = (i) => (tier.rowCount === 1 ? "GA" : `GA-${i + 1}`);
        break;
      case "custom": {
        const label = tier.customLabel?.trim() || "Section";
        area = slugifyArea(label);
        section = area;
        nameAt = (i) => `${label} ${i + 1}`;
        break;
      }
      case "rows":
      default:
        area = "orchestra";
        section = "main";
        nameAt = () => alphaLabel(seatedIndex++);
        break;
    }

    for (let i = 0; i < tier.rowCount; i++) {
      const capacity = tier.seatsPerRow;
      const rowName = nameAt(i);
      const seatNumbers = isGa
        ? Array.from({ length: capacity }, (_, s) => `GA-${i + 1}-${s + 1}`)
        : Array.from({ length: capacity }, (_, s) => String(s + 1));

      rows.push({
        id: `row-${rowRank}`,
        area,
        section,
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
