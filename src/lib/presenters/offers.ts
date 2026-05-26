// Presenter for the offer aggregate. Pure function: take a raw DB shape
// from the repository layer, return a view shape ready for JSON
// serialization.
//
// Privacy boundary (ADR-0017): the offer's private_threshold_cents is
// SERVER-ONLY and must never leak in an API response. This presenter is
// the chokepoint — it builds the view from a known set of fields and
// simply doesn't read private_threshold_cents, so even if a future
// caller passes a row read by mistake from another user, the threshold
// can't escape. Don't add the field here without re-reading ADR-0017.
//
// Scope: slice 4 only delivers the price/size/status/placed shape. The
// preview text (row + seat numbers) and the ticketReady flag stay
// deferred — they need seat_assignments + tickets, which arrive in a
// later slice. See PR description for the full deferred-fields table.

import { formatCents } from "@/lib/money";

import type { offers } from "../../../drizzle/schema";

type Offer = typeof offers.$inferSelect;

// Raw status enum from drizzle/schema.ts line 230. Kept as a string union
// so unknown future values still surface a TS error at the presenter
// boundary rather than silently rendering "undefined".
export type OfferStatus =
  | "pool"
  | "placed"
  | "unplaced"
  | "charged"
  | "card_failure"
  | "refunded"
  | "resold"
  | "gifted";

export type OfferView = {
  // priceCents stays in the view alongside the formatted string so any
  // downstream math (totals, displacement deltas) is exact and doesn't
  // re-parse the display string.
  priceCents: number;
  price: string;
  size: number;
  status: OfferStatus;
  // "Did this offer make it into a seat?" Both 'placed' (preview /
  // provisional) and 'charged' (post-binding) count as placed for the
  // Dashboard's purposes — the row badge that means "you have a seat."
  // 'pool' / 'unplaced' / failure / resale / gift statuses are not
  // placed.
  placed: boolean;
};

const PLACED_STATUSES: ReadonlySet<OfferStatus> = new Set(["placed", "charged"]);

export function presentOffer(offer: Offer): OfferView {
  const status = offer.status as OfferStatus;
  return {
    priceCents: offer.pricePerTicketCents,
    price: formatCents(offer.pricePerTicketCents),
    size: offer.groupSize,
    status,
    placed: PLACED_STATUSES.has(status),
  };
}
