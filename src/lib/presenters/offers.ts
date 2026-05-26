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
// The ticket's totp_secret is structurally protected upstream — the
// tickets repository never SELECTs it, so the TicketSummary passed in
// here can't carry it. See src/lib/db/repositories/tickets.ts for the
// reasoning (ADR-0015).
//
// What this presenter delivers for yourOffer:
//   priceCents/price/size/status/placed  - slice 4
//   preview ("Orchestra · Row AA …")     - slice 5b (needs assignment + arch row)
//   ticketReady                          - slice 6 (needs ticket)

import { formatCents } from "@/lib/money";

import type {
  SeatAssignment,
  TicketStatus,
  TicketSummary,
} from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

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
  // "Orchestra · Row AA · seats 7–10" — matches Dashboard.jsx line 17.
  // Omitted when there's no seat_assignment for the offer (or when the
  // presenter wasn't given the architecture row to look up the area /
  // rowName). exactOptionalPropertyTypes is on, so an absent key
  // doesn't serialize as `preview: undefined`.
  preview?: string;
  // "Is the rotating-QR ticket ready to view?" Used by Dashboard.jsx
  // line 62 to switch the row's click target between the ticket viewer
  // and the show page. Always present in the view (defaults false)
  // because the UI branches on it — undefined-as-falsy would be
  // ambiguous between "no ticket yet" and "didn't load ticket data."
  ticketReady: boolean;
};

const PLACED_STATUSES: ReadonlySet<OfferStatus> = new Set(["placed", "charged"]);

// Statuses that mean "we have a valid ticket to show this fan." Resold
// / gifted means the seat belongs to someone else now; expired means
// it's no longer scannable; issued / scanned are both displayable
// (the ticket viewer can render either a fresh QR or an
// "Already scanned at HH:MM" confirmation, so both count as "ready").
const READY_TICKET_STATUSES: ReadonlySet<TicketStatus> = new Set([
  "issued",
  "scanned",
]);

// Lowercase enum → display name. "ga" is the one that needs a fully
// custom mapping ("Ga" / "G a" both look wrong); everything else is
// just snake_case → title case.
const AREA_LABELS: Record<string, string> = {
  orchestra: "Orchestra",
  front_balcony: "Front Balcony",
  upper_balcony: "Upper Balcony",
  ga: "General Admission",
};

function formatAreaLabel(area: string): string {
  const known = AREA_LABELS[area];
  if (known) return known;
  // Defensive fall-through for any new area added later. snake_case →
  // Title Case so a forgotten entry above still renders sensibly.
  return area
    .split("_")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

function formatSeatRange(seatNumbers: readonly string[]): string {
  if (seatNumbers.length === 0) return "";
  if (seatNumbers.length === 1) return `seat ${seatNumbers[0]}`;
  const first = seatNumbers[0]!;
  const last = seatNumbers[seatNumbers.length - 1]!;
  // U+2013 EN DASH — matches the prototype copy ("seats 7–10"), not a
  // hyphen-minus. We use the en-dash convention for numeric ranges.
  return `seats ${first}–${last}`;
}

// Exported for tests + for ArtistDashboard's per-row provisionalFilled
// (which doesn't need the formatted string but does need the same
// area-label mapping for future use).
export function formatSeatAssignmentPreview(
  assignment: Pick<SeatAssignment, "seatNumbers">,
  row: Pick<VenueRow, "area" | "rowName">,
): string {
  const seatPart = formatSeatRange(assignment.seatNumbers);
  const base = `${formatAreaLabel(row.area)} · Row ${row.rowName}`;
  return seatPart ? `${base} · ${seatPart}` : base;
}

// userOffer is the *caller's* offer. assignment + row, when both
// present, produce yourOffer.preview. Either being absent omits the
// preview key (the caller hasn't been placed yet, OR the route handler
// hasn't joined the architecture, which is a programming error worth
// surfacing as "no preview" rather than a crash).
//
// ticket carries ticketReady. ticket is null when the assignment has
// no ticket yet (pre-T-48h) or there's no assignment at all. The
// derived ticketReady is always present in the view (defaults false).
export function presentOffer(
  offer: Offer,
  assignment: SeatAssignment | null = null,
  row: Pick<VenueRow, "area" | "rowName"> | null = null,
  ticket: Pick<TicketSummary, "status"> | null = null,
): OfferView {
  const status = offer.status as OfferStatus;
  const view: OfferView = {
    priceCents: offer.pricePerTicketCents,
    price: formatCents(offer.pricePerTicketCents),
    size: offer.groupSize,
    status,
    placed: PLACED_STATUSES.has(status),
    ticketReady: ticket ? READY_TICKET_STATUSES.has(ticket.status) : false,
  };
  if (assignment && row) {
    view.preview = formatSeatAssignmentPreview(assignment, row);
  }
  return view;
}
