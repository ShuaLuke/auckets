// Presenter for the Provisional placement seat map on the ShowAdmin
// page. Mirrors design/ui_kits/auckets/screens/ShowAdmin.jsx lines
// 227-269 — venue laid out as STAGE → tier sections → rows of seats,
// each seat colored by status.
//
// Status taxonomy in this slice:
//   placed     — a seat covered by a seat_assignment row.
//   unfilled   — a seat in the row but not in any assignment.
// Deferred (each needs its own data source):
//   orphan     — seats the GAE marked as unplaceable. allocation_logs
//                has ORPHAN_DETECTED rows; per-seat detail is in the
//                snapshot column. Wired in a later slice.
//   hold       — ADA / artist comp / production holds. holds table
//                doesn't exist yet (designed but not migrated).

import type { SeatAssignment, VenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow as GaeVenueRow } from "@/lib/gae/types";

export type SeatStatus = "placed" | "unfilled";

export type PlacementSeat = {
  number: string;
  status: SeatStatus;
};

export type PlacementRow = {
  rowId: string;
  rowName: string;
  rowRank: number;
  capacity: number;
  seats: readonly PlacementSeat[];
};

export type PlacementSection = {
  // Display label like "Premium" / "Mid" / "Rear". Rows without a tier
  // (the GAE allows it to be optional) land under "General admission".
  tier: string;
  rows: readonly PlacementRow[];
};

export type ProvisionalPlacementView = {
  sections: readonly PlacementSection[];
  summary: {
    placedSeats: number;
    unfilledSeats: number;
    totalSeats: number;
    fillRate: number; // 0-1
  };
};

const UNTIERED_LABEL = "General admission";

function tierLabelFor(row: GaeVenueRow): string {
  if (!row.tier) return UNTIERED_LABEL;
  // Schema stores tier as lower-case ("premium"). Title-case it for
  // display.
  return row.tier.charAt(0).toUpperCase() + row.tier.slice(1);
}

export function presentProvisionalPlacement(
  architecture: Pick<VenueArchitecture, "rows">,
  activeRowIds: readonly string[] | null,
  assignments: readonly Pick<SeatAssignment, "venueRowId" | "seatNumbers">[],
): ProvisionalPlacementView {
  const active = activeRowIds === null ? null : new Set(activeRowIds);

  // Index placed seats: rowId → Set of seat-number strings.
  const placedByRow = new Map<string, Set<string>>();
  for (const a of assignments) {
    let bag = placedByRow.get(a.venueRowId);
    if (!bag) {
      bag = new Set();
      placedByRow.set(a.venueRowId, bag);
    }
    for (const s of a.seatNumbers) bag.add(s);
  }

  // Build PlacementRow[] in venue order (rowRank ASC), filtered to
  // activeRowIds when provided.
  const archRows = architecture.rows as readonly GaeVenueRow[];
  const rowsInOrder = [...archRows]
    .filter((r) => (active === null ? true : active.has(r.id)))
    .sort((a, b) => a.rowRank - b.rowRank);

  let placedSeats = 0;
  let unfilledSeats = 0;
  const sectionsByTier = new Map<string, PlacementRow[]>();
  for (const row of rowsInOrder) {
    const tierLabel = tierLabelFor(row);
    const placedSet = placedByRow.get(row.id) ?? new Set<string>();
    const seats: PlacementSeat[] = row.seatNumbers.map((n) => {
      const isPlaced = placedSet.has(n);
      if (isPlaced) placedSeats++;
      else unfilledSeats++;
      return { number: n, status: isPlaced ? "placed" : "unfilled" };
    });
    const placementRow: PlacementRow = {
      rowId: row.id,
      rowName: row.rowName,
      rowRank: row.rowRank,
      capacity: row.capacity,
      seats,
    };
    let bucket = sectionsByTier.get(tierLabel);
    if (!bucket) {
      bucket = [];
      sectionsByTier.set(tierLabel, bucket);
    }
    bucket.push(placementRow);
  }

  const totalSeats = placedSeats + unfilledSeats;
  // Section order: by the lowest rowRank in each section, so the
  // closest-to-stage tier renders first. Matches the prototype's
  // "Premium → Mid → Rear" ordering when rowRanks line up that way.
  const sections: PlacementSection[] = [...sectionsByTier.entries()]
    .map(([tier, rows]) => ({ tier, rows }))
    .sort((a, b) => {
      const aMin = a.rows[0]?.rowRank ?? Number.POSITIVE_INFINITY;
      const bMin = b.rows[0]?.rowRank ?? Number.POSITIVE_INFINITY;
      return aMin - bMin;
    });

  return {
    sections,
    summary: {
      placedSeats,
      unfilledSeats,
      totalSeats,
      fillRate: totalSeats > 0 ? placedSeats / totalSeats : 0,
    },
  };
}
