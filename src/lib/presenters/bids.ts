// Presenter for the fan-side bid history page (/my-bids).
//
// Each BidView is one row in the user's bid history — the current state
// of their offer on a given show. There's no offer-revision history
// today (last-write-wins on the offers table); the `isRevised` flag
// and `revisedDisplay` surface the existence of revisions but not their
// content. Full version history is parked as a follow-up — see the
// project_offer_revision_history memory.

import { formatCents } from "@/lib/money";

import type { UserBidRow } from "@/lib/db/repositories";

import { DEFAULT_TZ, formatDateLong, formatDateShort } from "./format";
import type { OfferStatus } from "./offers";
import type { ShowStatus } from "./shows";

// Tier-preference label mapping mirrors the OfferComposer's surfaced
// options (Premium only / Premium or below / Anywhere I fit). The 4th
// schema value 'this_or_better' isn't a composer option today; if
// somehow stored, it surfaces as "Premium or above" so the user sees
// the literal tier choice that was made.
function tierLabelFor(
  tierPreference: string,
  preferredTier: string | null,
): string {
  if (tierPreference === "specific" && preferredTier) {
    return `${capitalize(preferredTier)} only`;
  }
  if (tierPreference === "this_or_worse" && preferredTier) {
    return `${capitalize(preferredTier)} or below`;
  }
  if (tierPreference === "this_or_better" && preferredTier) {
    return `${capitalize(preferredTier)} or above`;
  }
  return "Anywhere I fit";
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// Status copy is intentionally fan-friendly. A few of the schema
// statuses ('charged', 'refunded', 'resold', 'gifted', 'card_failure')
// only land post-binding; the labels here cover all of them so the
// historical view degrades gracefully once those flows ship.
const OFFER_STATUS_LABEL: Record<OfferStatus, string> = {
  pool: "In pool",
  placed: "Placed",
  unplaced: "Not placed",
  charged: "Ticket purchased",
  card_failure: "Payment failed",
  refunded: "Refunded",
  resold: "Resold",
  gifted: "Gifted",
};

const SHOW_STATUS_HINT: Record<ShowStatus, string | null> = {
  draft: "Show not yet open",
  open: null,
  paused: "Offers paused",
  closed: "Offers closed",
  allocating: "Seating in progress",
  allocated: "Seats confirmed",
  complete: "Show complete",
};

export type BidView = {
  offerId: string;
  showId: string;
  artist: string;
  venue: string;
  city: string | null;
  dateLong: string;
  dateShort: string;
  groupSize: number;
  pricePerTicket: string;
  totalIfPlaced: string;
  tierLabel: string;
  offerStatusLabel: string;
  showStatusHint: string | null;
  submittedDisplay: string;
  // null if the offer hasn't been revised yet.
  revisedDisplay: string | null;
  isRevised: boolean;
};

export function presentBidView(
  row: UserBidRow,
  tz: string = DEFAULT_TZ,
): BidView {
  const { offer, show } = row;
  const totalCents = offer.pricePerTicketCents * offer.groupSize;
  return {
    offerId: offer.id,
    showId: show.id,
    artist: show.artistName,
    venue: show.venueName,
    city: show.venueCity,
    dateLong: formatDateLong(show.doorsAt, tz),
    dateShort: formatDateShort(show.doorsAt, tz),
    groupSize: offer.groupSize,
    pricePerTicket: formatCents(offer.pricePerTicketCents),
    totalIfPlaced: formatCents(totalCents),
    tierLabel: tierLabelFor(offer.tierPreference, offer.preferredTier),
    offerStatusLabel: OFFER_STATUS_LABEL[offer.status as OfferStatus] ?? offer.status,
    showStatusHint: SHOW_STATUS_HINT[show.status as ShowStatus] ?? null,
    submittedDisplay: formatDateLong(offer.submittedAt, tz),
    revisedDisplay: offer.revisedAt
      ? formatDateLong(offer.revisedAt, tz)
      : null,
    isRevised: offer.revisedAt !== null,
  };
}
