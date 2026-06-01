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
  // Fan-intent note for the dashboard offer chip (Change 02 §C): proxy-cap
  // framing for a tier preference ("we'll only use what's needed"), or "any
  // seat is fine" when the fan will take anything. Always present. Frames the
  // fan's intent, never the mechanism.
  intentNote: string;
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
  // Real per-ticket amount charged at binding (formatted), present only once
  // charged. Lets the NowHero say "You paid $39 ×N" with the true number
  // rather than the cap. Omitted pre-binding.
  paidPerTicket?: string;
  // The guaranteed-floor "you're in, the question is where" telemetry for
  // the dashboard StandingLadder (Change 02). Present only on a pre-binding
  // offer that has a preview seat-assignment to project from; omitted
  // otherwise (and the row falls back to the bare offer chip). Computed by
  // presentStanding from the cached preview projection — never a from-
  // scratch GAE re-run (Risk Register §3.3).
  standing?: StandingView;
};

// The calm "you're in — you'd land in {tier}" strip on each active offer.
// Rank-free by construction (README §6.1 guaranteed floor): it names a
// projected tier + human position and frames the next tier up as an
// *upgrade opportunity*, never "you're below the line."
export type StandingView = {
  // Projected pricing tier label, e.g. "Mid" (from seat_assignments.tier).
  projectedTier: string;
  // Human position: "around row F" for singles/pairs, "together" when the
  // salient fact for a larger group is that their seats stay adjacent.
  positionHint: string;
  // The fan's offer cap (cents) — what they're willing to go up to.
  capCents: number;
  // The next tier up + what it currently takes to reach it. Cents for any
  // downstream math; *Display are the formatted strings the ladder renders
  // (formatting stays in the presenter). Omitted when the fan is already in
  // the top tier, or when no honest upgrade number exists (their cap already
  // clears the next floor but the tier is full — we don't fake a "+$0" nudge).
  nextTier?: {
    label: string;
    lineCents: number;
    lineDisplay: string;
    deltaCents: number;
    deltaDisplay: string;
  };
  // True only when the projected tier is the highest-priced tier — the
  // ladder then drops the reach row and reads "front section, nothing
  // more to do."
  inTopTier: boolean;
};

const PLACED_STATUSES: ReadonlySet<OfferStatus> = new Set(["placed", "charged"]);

// Tier preferences that carry a specific target the proxy works toward.
// "any" (Anywhere I fit) is the complement — the fan will take any seat.
const PROXY_TIER_PREFERENCES: ReadonlySet<string> = new Set([
  "specific",
  "this_or_worse",
  "this_or_better",
]);

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
    intentNote: PROXY_TIER_PREFERENCES.has(offer.tierPreference)
      ? "we'll only use what's needed"
      : "any seat is fine",
    ticketReady: ticket ? READY_TICKET_STATUSES.has(ticket.status) : false,
  };
  if (assignment && row) {
    view.preview = formatSeatAssignmentPreview(assignment, row);
  }
  // The real per-ticket amount charged at binding (not the cap). The charged
  // total lives on the seat_assignment (set by run-binding), so it's present
  // only once placed-and-charged. Lets the NowHero ticket-ready band say
  // "You paid $39 ×N" with the true number — correct even if uniform
  // clearing price later diverges the charge from the offer cap (README §6.2).
  if (
    assignment &&
    assignment.chargedAmountCents !== null &&
    offer.groupSize > 0
  ) {
    view.paidPerTicket = formatCents(
      Math.round(assignment.chargedAmountCents / offer.groupSize),
    );
  }
  return view;
}

function capitalizeTier(tier: string): string {
  return tier.length === 0 ? tier : tier[0]!.toUpperCase() + tier.slice(1);
}

// Build the StandingLadder telemetry for one pre-binding offer. Pure: the
// caller supplies the offer, its preview seat-assignment (the cached
// projection), the resolved architecture row, and the show's tier floors.
//
// Returns null when there's no projection to stand on (no preview
// assignment, or the assignment's tier isn't among the show's floors) —
// the row then renders the bare offer chip with no ladder, per the spec's
// "omit standing if preview unavailable" degradation.
//
// Never emits a rank or a "below the line" framing (README §6.1). The
// projected tier is honest; the next-tier delta is an upgrade opportunity,
// using the tier *floor* as the reach number (the honest "what gets you in"
// while seats are open — same basis as presentMinToGetIn's open-seats case).
export function presentStanding(
  offer: Offer,
  assignment: Pick<SeatAssignment, "tier"> | null,
  row: Pick<VenueRow, "rowName"> | null,
  tierFloorsCents: Record<string, number>,
): StandingView | null {
  if (!assignment) return null;

  // Tiers ordered cheapest → priciest by floor. The last entry is the top
  // (best) tier; the entry after the projected tier is the next one up.
  const sorted = Object.entries(tierFloorsCents).sort((a, b) => a[1] - b[1]);
  const idx = sorted.findIndex(([name]) => name === assignment.tier);
  if (idx === -1) return null; // projected tier not in floors — can't project a reach

  const capCents = offer.pricePerTicketCents;
  const positionHint =
    offer.groupSize >= 3 ? "together" : `around row ${row?.rowName ?? "?"}`;

  const view: StandingView = {
    projectedTier: capitalizeTier(assignment.tier),
    positionHint,
    capCents,
    inTopTier: idx === sorted.length - 1,
  };

  const next = sorted[idx + 1];
  if (next) {
    const [nextName, nextFloor] = next;
    const deltaCents = nextFloor - capCents;
    // Only surface the reach as an opportunity when there's an honest
    // positive number to raise by. A non-positive delta means their cap
    // already clears that floor yet they didn't land there (the tier is
    // full) — we don't fabricate a "+$0" nudge.
    if (deltaCents > 0) {
      view.nextTier = {
        label: capitalizeTier(nextName),
        lineCents: nextFloor,
        lineDisplay: formatCents(nextFloor),
        deltaCents,
        deltaDisplay: formatCents(deltaCents),
      };
    }
  }

  return view;
}
