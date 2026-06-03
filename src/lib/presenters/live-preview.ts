// Presenter for the live-dial projection (Change 04). Formats a pure
// CandidateProjection into the client-facing shape the composer's map +
// standing line read as the fan turns the price dial. Money/seat formatting
// lives here, never in the route.
//
// Guaranteed-floor language, never a raw rank (README §6.1): the standing line
// is "You're in — you'd land in {tier}" + an optional "raise to reach {next}".
// Pay-as-bid: payPerTicket is exactly what the fan offered (the dial value);
// no clearing line.

import { formatCents } from "@/lib/money";

import type { CandidateProjection } from "@/lib/allocation/project-candidate";
import type { Offer, SeatAssignment } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import { presentStanding } from "./offers";

export type LiveStandingView = {
  projectedTier: string;
  positionHint: string;
  inTopTier: boolean;
  nextTier: { label: string; deltaDisplay: string } | null;
};

export type LiveProjectionView =
  | {
      available: true;
      placed: boolean;
      tierLabel: string | null;
      rowName: string | null;
      seatRange: string | null;
      payPerTicket: string;
      // The fan's projected seats, for the live map highlight.
      yourSeats: { rowId: string; numbers: readonly string[] } | null;
      standing: LiveStandingView | null;
    }
  | { available: false; reason: "closed" };

// "premium" → "Premium"; "ga" stays "GA".
function tierLabel(tier: string): string {
  if (tier.toLowerCase() === "ga") return "GA";
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function seatRange(numbers: readonly string[]): string | null {
  if (numbers.length === 0) return null;
  if (numbers.length === 1) return numbers[0]!;
  return `${numbers[0]}–${numbers[numbers.length - 1]}`;
}

export type LiveProjectionInput = {
  pricePerTicketCents: number;
  groupSize: number;
  tierPreference: Offer["tierPreference"];
  preferredTier: string | null;
  projection: CandidateProjection;
  rowName: string | null;
  tierFloorsCents: Record<string, number>;
};

export function presentLiveProjection(
  input: LiveProjectionInput,
): Extract<LiveProjectionView, { available: true }> {
  if (!input.projection.placed || input.projection.tier === null) {
    return {
      available: true,
      placed: false,
      tierLabel: null,
      rowName: null,
      seatRange: null,
      payPerTicket: formatCents(input.pricePerTicketCents),
      yourSeats: null,
      standing: null,
    };
  }

  const tier = input.projection.tier;

  // Reuse the dashboard standing presenter (Change 02) for the
  // guaranteed-floor / reach-the-next-tier language. It reads only price +
  // group size off the offer, so a minimal stand-in is enough.
  const offerLike = {
    pricePerTicketCents: input.pricePerTicketCents,
    groupSize: input.groupSize,
  } as Offer;
  const assignmentLike = { tier } as Pick<SeatAssignment, "tier">;
  const rowLike = { rowName: input.rowName ?? "" } as Pick<VenueRow, "rowName">;
  const standing = presentStanding(
    offerLike,
    assignmentLike,
    rowLike,
    input.tierFloorsCents,
  );

  return {
    available: true,
    placed: true,
    tierLabel: tierLabel(tier),
    rowName: input.rowName,
    seatRange: seatRange(input.projection.seatNumbers),
    payPerTicket: formatCents(input.pricePerTicketCents),
    yourSeats:
      input.projection.venueRowId !== null
        ? {
            rowId: input.projection.venueRowId,
            numbers: input.projection.seatNumbers,
          }
        : null,
    standing: standing
      ? {
          projectedTier: standing.projectedTier,
          positionHint: standing.positionHint,
          inTopTier: standing.inTopTier,
          nextTier: standing.nextTier
            ? {
                label: standing.nextTier.label,
                deltaDisplay: standing.nextTier.deltaDisplay,
              }
            : null,
        }
      : null,
  };
}
