// Presenter for the fan Show detail VenuePreview. Mirrors
// design/ui_kits/auckets/screens/Show.jsx VenuePreview (lines 220-260) —
// the venue map with STAGE marker, tier sections, and per-row seat
// strips. The fan's seats are highlighted; everyone else's seats are
// drawn as anonymous "filled" markers.
//
// Why a separate presenter instead of reusing presentProvisionalPlacement:
// the artist-side ProvisionalPlacementCard switches on a 2-value SeatStatus
// (placed | unfilled). The fan-side needs a 3-value status (yours |
// placed | unfilled). Extending the shared type would force the artist
// component to handle a value it can never receive; cloning the small
// presenter here keeps the artist surface untouched and the fan-side
// contract explicit. Same shape, plus the "yours" overlay.
//
// Privacy: assignments carry (offer_id, row_id, seat_numbers). They don't
// carry the offer's user_id, so rendering "this seat is filled" doesn't
// expose which fan sits where. The only identity-linked seats are the
// caller's own — passed in explicitly via userAssignment.

import type { SeatAssignment, VenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow as GaeVenueRow } from "@/lib/gae/types";

export type FanSeatStatus = "yours" | "placed" | "unfilled";

export type FanSeat = {
  number: string;
  status: FanSeatStatus;
};

export type FanRow = {
  rowId: string;
  rowName: string;
  rowRank: number;
  isYourRow: boolean;
  seats: readonly FanSeat[];
};

export type FanSection = {
  tier: string;
  rows: readonly FanRow[];
};

export type VenuePreviewView = {
  sections: readonly FanSection[];
  hasYourPlacement: boolean;
};

const UNTIERED_LABEL = "General admission";

function tierLabelFor(row: GaeVenueRow): string {
  if (!row.tier) return UNTIERED_LABEL;
  return row.tier.charAt(0).toUpperCase() + row.tier.slice(1);
}

export function presentFanVenuePreview(
  architecture: Pick<VenueArchitecture, "rows">,
  activeRowIds: readonly string[] | null,
  assignments: readonly Pick<SeatAssignment, "venueRowId" | "seatNumbers">[],
  userAssignment: Pick<SeatAssignment, "venueRowId" | "seatNumbers"> | null,
): VenuePreviewView {
  const active = activeRowIds === null ? null : new Set(activeRowIds);

  // Index placed seats — same shape as the artist presenter.
  const placedByRow = new Map<string, Set<string>>();
  for (const a of assignments) {
    let bag = placedByRow.get(a.venueRowId);
    if (!bag) {
      bag = new Set();
      placedByRow.set(a.venueRowId, bag);
    }
    for (const s of a.seatNumbers) bag.add(s);
  }

  // Index the caller's own seats so the per-seat check is O(1).
  const yourSeats =
    userAssignment === null
      ? null
      : new Set(userAssignment.seatNumbers);
  const yourRowId = userAssignment?.venueRowId ?? null;

  const archRows = architecture.rows as readonly GaeVenueRow[];
  const rowsInOrder = [...archRows]
    .filter((r) => (active === null ? true : active.has(r.id)))
    .sort((a, b) => a.rowRank - b.rowRank);

  const sectionsByTier = new Map<string, FanRow[]>();
  for (const row of rowsInOrder) {
    const tierLabel = tierLabelFor(row);
    const placedSet = placedByRow.get(row.id) ?? new Set<string>();
    const isYourRow = row.id === yourRowId;
    const seats: FanSeat[] = row.seatNumbers.map((n) => {
      if (isYourRow && yourSeats?.has(n)) {
        return { number: n, status: "yours" };
      }
      return {
        number: n,
        status: placedSet.has(n) ? "placed" : "unfilled",
      };
    });
    const fanRow: FanRow = {
      rowId: row.id,
      rowName: row.rowName,
      rowRank: row.rowRank,
      isYourRow,
      seats,
    };
    let bucket = sectionsByTier.get(tierLabel);
    if (!bucket) {
      bucket = [];
      sectionsByTier.set(tierLabel, bucket);
    }
    bucket.push(fanRow);
  }

  // Section order: closest-to-stage tier first (lowest rowRank).
  // Mirrors the artist presenter's ordering exactly.
  const sections: FanSection[] = [...sectionsByTier.entries()]
    .map(([tier, rows]) => ({ tier, rows }))
    .sort((a, b) => {
      const aMin = a.rows[0]?.rowRank ?? Number.POSITIVE_INFINITY;
      const bMin = b.rows[0]?.rowRank ?? Number.POSITIVE_INFINITY;
      return aMin - bMin;
    });

  return {
    sections,
    hasYourPlacement: userAssignment !== null,
  };
}
