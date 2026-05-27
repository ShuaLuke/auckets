// Presenter for the fan Show detail "Live preview" banner. Mirrors the
// PreviewBanner in design/ui_kits/auckets/screens/Show.jsx (lines
// 187-218) — the inverse Card that says "You'd land in Premium · Row A
// · seats 7–15" when the fan has a provisional placement, or a warm
// Card with helper copy when they don't.
//
// Three states (discriminated union — the component switches on `state`
// and TypeScript ensures every branch handles each one):
//
//   no-offer       — fan hasn't submitted an offer yet. Warm helper card.
//   no-placement   — fan has an offer but no preview has run, OR the offer
//                    is in a terminal status that doesn't carry a placement.
//   placed         — fan has a placement; render the inverse banner with
//                    tier · row · seats.
//
// The presenter sits between the page (which loads the offer + assignment)
// and the component (which renders). No DB knowledge here, no UI knowledge.

import type { SeatAssignment } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import type { offers } from "../../../drizzle/schema";

type Offer = typeof offers.$inferSelect;

export type PreviewBannerView =
  | { state: "no-offer" }
  | { state: "no-placement" }
  | {
      state: "placed";
      // "Premium" | "Mid" | "Rear" | "General admission". Capitalized
      // for display; null in the design too if the row carries no tier.
      tierLabel: string;
      // "A" / "AA" / etc.
      rowName: string;
      // Pre-formatted: "7" if single seat, "7–10" en-dashed range for
      // contiguous. Component just renders the string.
      seatRange: string;
    };

const UNTIERED_LABEL = "General admission";

function tierLabelFor(row: Pick<VenueRow, "tier">): string {
  if (!row.tier) return UNTIERED_LABEL;
  return row.tier.charAt(0).toUpperCase() + row.tier.slice(1);
}

function formatSeatRange(seatNumbers: readonly string[]): string {
  if (seatNumbers.length === 0) return "";
  if (seatNumbers.length === 1) return seatNumbers[0]!;
  const first = seatNumbers[0]!;
  const last = seatNumbers[seatNumbers.length - 1]!;
  // U+2013 EN DASH — matches the design copy ("seats 7–15") and the
  // formatSeatAssignmentPreview helper in lib/presenters/offers.ts.
  return `${first}–${last}`;
}

export function presentPreviewBanner(
  userOffer: Offer | null,
  userAssignment: Pick<SeatAssignment, "seatNumbers"> | null,
  userAssignmentRow: Pick<VenueRow, "tier" | "rowName"> | null,
): PreviewBannerView {
  if (!userOffer) return { state: "no-offer" };
  if (!userAssignment || !userAssignmentRow) {
    return { state: "no-placement" };
  }
  return {
    state: "placed",
    tierLabel: tierLabelFor(userAssignmentRow),
    rowName: userAssignmentRow.rowName,
    seatRange: formatSeatRange(userAssignment.seatNumbers),
  };
}
