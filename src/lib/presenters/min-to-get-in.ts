// Presenter for the Show-header "minimum bid to get in" tracker (QA
// 2026-05-29). Answers the fan's question — "what would it take to hold a
// seat right now?" — with one honest number, and a sub that says which
// kind of number it is:
//
//   • Room is full (provisional placements ≥ capacity): the cutoff is real
//     competition. We show the *marginal placed price* — the lowest
//     price-per-ticket among offers currently holding a seat. Beat it and
//     you displace someone; match-or-below and you're out.
//
//   • Seats still open (placements < capacity, or no preview has run): there
//     is no cutoff yet — any valid offer at/above the tier floor currently
//     fits. We show the *cheapest tier floor* so the number never overstates
//     what it costs to get in.
//
// Pure formatting. The page loader supplies the marginal placed price (or
// null), the show's tier floors, the provisional fill count, and capacity.

import { formatCents } from "@/lib/money";

const EMPTY = "—";

export type MinToGetInView = {
  // Display-ready price string, or "—" when neither a cutoff nor a floor
  // is known (e.g. no architecture loaded and nothing placed).
  label: string;
  // One-line qualifier explaining what the number is.
  sub: string;
  // True when `label` is the live competitive cutoff (room full), false
  // when it's the tier floor (seats still open). Lets the component tint
  // the cutoff case differently if it wants to.
  isCutoff: boolean;
};

export function presentMinToGetIn(
  marginalPlacedCents: number | null,
  tierFloorsCents: Record<string, number>,
  provisionalFilled: number,
  capacity: number,
): MinToGetInView {
  const roomFull = capacity > 0 && provisionalFilled >= capacity;

  if (roomFull && marginalPlacedCents !== null) {
    return {
      label: formatCents(marginalPlacedCents),
      sub: "to make the room",
      isCutoff: true,
    };
  }

  // Seats still open (or no placements yet): the cheapest floor is the real
  // "what gets you in right now" — showing the lowest placed price here
  // would overstate it, since empty seats mean a floor-level offer fits.
  const floors = Object.values(tierFloorsCents);
  if (floors.length > 0) {
    return {
      label: formatCents(Math.min(...floors)),
      sub: "seats still open",
      isCutoff: false,
    };
  }

  return { label: EMPTY, sub: "minimum bid", isCutoff: false };
}
