// Presenter for the post-binding fan result page — the real counterpart to
// design/ui_kits/auckets/screens/AllocationFinal.jsx. Given the fan's own
// offer + its binding seat assignment (if any), decide which of the three
// terminal outcomes to render and with what copy. Repositories hand back raw
// rows; the gating, money math, and formatting live here so the route stays
// thin and the decision is unit-testable.
//
// Three outcomes, all *post-binding* (the route 404s on anything else):
//   placed       — charged, binding seat held. The "you're in" ticket stub.
//   card_failure — binding seat held but the capture failed; recovery still
//                  open. Points the fan back to the Show page's recovery CTA.
//   unplaced     — cleared the pool but didn't make the cut; auth released,
//                  no charge.
//
// Why gate here and not in the route: keeping the status→outcome mapping in a
// pure function means the edge cases (preview placement that isn't binding
// yet, pool/refunded/resold/gifted) are covered by tests, not by reading the
// route by eye.

import { formatCents } from "@/lib/money";

import type { Offer, SeatAssignment } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import { formatDateLong, DEFAULT_TZ } from "./format";
import { formatSeatAssignmentPreview } from "./offers";

// Minimal structural slice of the show the presenter needs. A Pick rather
// than the full ShowWithRelations so tests can build a subject without a
// whole venue architecture.
export type AllocationFinalShow = {
  id: string;
  artist: { name: string };
  venue: { name: string; city: string | null };
  doorsAt: Date;
};

type Base = {
  showId: string;
  artist: string;
  venue: string;
  city: string | null;
  // "Sat · May 25 · 8pm" — the show's doors time, prototype dateLong shape.
  dateLong: string;
};

export type AllocationFinalPlacedView = Base & {
  kind: "placed";
  // Section / Row / Seats map to the prototype's 2×2 SeatBlock grid.
  tierLabel: string; // "Premium"
  rowName: string; // "AA" (empty if the architecture row couldn't be resolved)
  seats: string; // "9 · 11 · 13 · 15"
  size: number;
  pricePerTicket: string; // "$42.00"
  chargedTotal: string; // "$168.00" — from the seat assignment's captured amount
  // Whether the rotating-QR ticket is already issued, so the page can offer a
  // "View ticket" link instead of "appears 48h before doors."
  ticketReady: boolean;
};

export type AllocationFinalCardFailureView = Base & {
  kind: "card_failure";
  size: number;
  amountDue: string; // price × size — what recovery will collect
};

export type AllocationFinalUnplacedView = Base & {
  kind: "unplaced";
  offerPrice: string; // "$22.00"
  size: number;
};

export type AllocationFinalView =
  | AllocationFinalPlacedView
  | AllocationFinalCardFailureView
  | AllocationFinalUnplacedView;

// snake_case / lowercase tier → Title Case ("premium" → "Premium"). Mirrors
// the area-label fall-through in offers.ts; tiers are author-defined strings
// so we title-case defensively rather than maintain a fixed map.
function titleCaseTier(tier: string): string {
  return tier
    .split("_")
    .map((part) =>
      part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1),
    )
    .join(" ");
}

// Returns the result view, or null when there's no *final* outcome to show:
//   - the offer is still pre-binding (pool, or a non-binding preview
//     placement) — the result page isn't meaningful yet,
//   - or the offer has moved past the result (refunded / resold / gifted).
// The route turns null into a 404.
export function presentAllocationFinal(
  show: AllocationFinalShow,
  offer: Offer,
  seat: SeatAssignment | null,
  row: Pick<VenueRow, "area" | "rowName"> | null,
  ticketReady: boolean,
  now: Date,
  tz: string = DEFAULT_TZ,
): AllocationFinalView | null {
  const base: Base = {
    showId: show.id,
    artist: show.artist.name,
    venue: show.venue.name,
    city: show.venue.city,
    dateLong: formatDateLong(show.doorsAt, tz),
  };

  // Placed and charged — money moved, binding seat held. The "you're in" card.
  if (offer.status === "charged" && seat?.isBinding) {
    // chargedAmountCents is the authoritative captured total; fall back to
    // price × size only if a charged offer somehow lacks the stamp.
    const total =
      seat.chargedAmountCents ?? offer.pricePerTicketCents * offer.groupSize;
    return {
      ...base,
      kind: "placed",
      tierLabel: titleCaseTier(seat.tier),
      rowName: row?.rowName ?? "",
      seats: seat.seatNumbers.join(" · "),
      size: offer.groupSize,
      pricePerTicket: formatCents(offer.pricePerTicketCents),
      chargedTotal: formatCents(total),
      ticketReady,
    };
  }

  // Binding seat held but the capture failed — recovery is handled on the
  // Show page; here we just acknowledge the outcome and point the fan there.
  if (offer.status === "card_failure" && seat?.isBinding) {
    return {
      ...base,
      kind: "card_failure",
      size: offer.groupSize,
      amountDue: formatCents(offer.pricePerTicketCents * offer.groupSize),
    };
  }

  // Cleared the pool but didn't make the cut — auth released, no charge.
  if (offer.status === "unplaced") {
    return {
      ...base,
      kind: "unplaced",
      offerPrice: formatCents(offer.pricePerTicketCents),
      size: offer.groupSize,
    };
  }

  return null;
}

// Re-export so callers can keep the seat-preview helper colocated with the
// other presenter usage if they want the combined string instead of the
// split fields. (Not used by the page, but handy for a future inbox row.)
export { formatSeatAssignmentPreview };
