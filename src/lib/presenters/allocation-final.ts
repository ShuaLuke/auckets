// Presenter for the post-binding fan result screen (Change 03) — the
// highest-stakes surface in the product. Given the fan's own offer + its
// binding seat assignment (if any) and a small per-show context, decide which
// outcome to render and with what copy. Repositories hand back raw rows; the
// gating, money math, A/B framing, and formatting live here so the route stays
// thin and the decision is unit-testable.
//
// Three outcomes, all *post-binding* (the route 404s on anything else):
//   placed       — charged, binding seat held. Splits into two *emotional
//                  states* (never two data kinds): "in-room" (landed at/above
//                  the section they hoped for) and "fallback" (landed lower —
//                  the churn-risk screen). State is gracious: when we can't
//                  tell, we pick "fallback".
//   card_failure — binding seat held but the capture failed; recovery still
//                  open. Leads with "you're in", calmly.
//   unplaced     — an oversubscribed show left this offer out; auth released,
//                  no charge, no fees.
//
// PRICING MODEL — pay-as-bid / proxy (src/lib/allocation/run-binding.ts). Each
// fan pays what their offer settled at, NOT a uniform clearing line. An
// auto-offer fan pays only what was needed to hold their seat, capped at their
// authorized cap. So the only honest "under cap" case is an auto-offer that
// settled below its cap. We read the *real* charged amount off the seat
// assignment and never re-derive it from a clearing price.

import { formatCents } from "@/lib/money";

import type { CardFailureRecoveryView } from "./card-failure";
import type { Offer, SeatAssignment } from "@/lib/db/repositories";
import type { VenueRow } from "@/lib/gae/types";

import { formatClock, formatDateLong, DEFAULT_TZ } from "./format";
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

// Per-show context the route assembles from repositories + sibling presenters.
// Pulled out of the show slice so the placed branch can stay pure and the
// route owns the (async) data fetches.
export type AllocationResultContext = {
  // Offers in the active pool — "412 fans said what the night was worth."
  poolCount: number;
  // Active-row seat count — "for 1,200 seats."
  capacity: number;
  // tier key → the closest (lowest) rowRank among that tier's active rows.
  // Lower rank = closer to the stage = a "better" section. Drives the A/B
  // state decision (placed tier vs the tier the fan hoped for).
  tierMinRowRank: Record<string, number>;
  // Lowest per-ticket price among placed offers — the last seat that got in.
  // Used only by the unplaced edge ("yours didn't reach the last seat taken").
  marginalPlacedCents: number | null;
  // The card-failure recovery view (deadline + minutes), or null when there's
  // nothing to recover. Reused verbatim from the Show page's presenter.
  cardFailure: CardFailureRecoveryView | null;
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
  // The emotional state — never a separate data kind. "in-room" gets the full
  // celebration hero; "fallback" gets the softer, honest one.
  state: "in-room" | "fallback";
  // "Orchestra · Row AA · seats 7–10" — the hero seat line (area-based, what
  // the fan recognises), built from the resolved architecture row.
  seatLine: string;
  size: number;
  // --- ResultRecap (pay-as-bid, never a clearing line) ---
  // The authorized cap: the auto-offer cap when set, else the flat offer.
  capDisplay: string; // "$42.00"
  // The real per-ticket amount charged (chargedAmountCents / size) — never
  // re-derived from a line.
  paidPerTicketDisplay: string; // "$39.00"
  chargedTotalDisplay: string; // "$156.00"
  // True only when an auto-offer settled strictly below its cap — the one
  // honest "you saved" case. Drives the "settled at" row + save chip.
  isAutoUnderCap: boolean;
  underCapDisplay: string | null; // "$3.00" — cap − settled, per ticket
  // --- WhyYouLanded ---
  poolCount: number;
  capacity: number;
  // --- NextInLine (fallback only) ---
  // The fan's position in the move-up queue. null whenever it isn't honestly
  // computable (it never is yet — displacement.ts exposes no rank), in which
  // case the card is omitted rather than faked.
  moveUpPosition: number | null;
  ticketReady: boolean;
};

export type AllocationFinalCardFailureView = Base & {
  kind: "card_failure";
  size: number;
  seatLine: string;
  amountDueDisplay: string; // price × size — what recovery will collect
  // "8:45pm" — the time the held seats lapse, or null if the window is
  // already gone (the expiry cron will release them).
  deadlineLabel: string | null;
  minutesLeft: number | null;
};

export type AllocationFinalUnplacedView = Base & {
  kind: "unplaced";
  offerPriceDisplay: string; // "$22.00"
  size: number;
  // The lowest per-ticket price that did get a seat — "the last seat taken
  // went for $24". null when nothing placed (degrade to the generic line).
  marginalDisplay: string | null;
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

// tier key → closest (lowest) rowRank among that tier's *active* rows. Lower
// rank = closer to stage = the section a fan hopes for. Exported + pure so the
// A/B decision is unit-testable without a whole architecture.
export function buildTierMinRowRank(
  rows: readonly Pick<VenueRow, "id" | "rowRank" | "tier">[],
  activeRowIds: readonly string[] | null,
): Record<string, number> {
  const active = activeRowIds === null ? null : new Set(activeRowIds);
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (active && !active.has(row.id)) continue;
    const tier = row.tier ?? "";
    const current = out[tier];
    if (current === undefined || row.rowRank < current) out[tier] = row.rowRank;
  }
  return out;
}

// Decide the placed *state* by comparing where the fan landed to where they
// hoped. Gracious by design: any uncertainty resolves to "fallback" (which
// reads well either way), since the celebration only fits a clear win.
function decidePlacedState(
  seatTier: string,
  preferredTier: string | null,
  tierMinRowRank: Record<string, number>,
): "in-room" | "fallback" {
  const placedRank = tierMinRowRank[seatTier];
  if (placedRank === undefined) return "fallback";

  // A named preferred tier (specific / this_or_better / this_or_worse): you're
  // "in the room" if you landed in it or anything closer.
  if (preferredTier) {
    const preferredRank = tierMinRowRank[preferredTier];
    if (preferredRank === undefined) return "fallback";
    return placedRank <= preferredRank ? "in-room" : "fallback";
  }

  // "any" preference (no named tier): celebrate only when you landed in the
  // closest section there is. Anything further back is the gracious fallback.
  const ranks = Object.values(tierMinRowRank);
  if (ranks.length === 0) return "fallback";
  return placedRank <= Math.min(...ranks) ? "in-room" : "fallback";
}

// Build the hero seat line. Prefer the area-based preview ("Orchestra · Row AA
// · seats 7–10"); degrade to tier + seat range if the architecture row
// couldn't be resolved (a data inconsistency, not an expected path).
function buildSeatLine(
  seat: Pick<SeatAssignment, "seatNumbers" | "tier">,
  row: Pick<VenueRow, "area" | "rowName"> | null,
): string {
  if (row) return formatSeatAssignmentPreview(seat, row);
  const tier = titleCaseTier(seat.tier);
  if (seat.seatNumbers.length === 0) return tier;
  if (seat.seatNumbers.length === 1) return `${tier} · seat ${seat.seatNumbers[0]}`;
  const first = seat.seatNumbers[0]!;
  const last = seat.seatNumbers[seat.seatNumbers.length - 1]!;
  return `${tier} · seats ${first}–${last}`;
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
  context: AllocationResultContext,
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
    // The authorized cap: an auto-offer's cap when enabled, otherwise the flat
    // offer (in pay-as-bid a flat offer pays exactly itself).
    const capCents =
      offer.autoBidEnabled && offer.autoBidCapCents !== null
        ? offer.autoBidCapCents
        : offer.pricePerTicketCents;

    // The REAL per-ticket charge, from the seat assignment's captured total —
    // never re-derived. Fall back to the flat offer only if a charged offer
    // somehow lacks the stamp.
    const chargedTotalCents =
      seat.chargedAmountCents ?? offer.pricePerTicketCents * offer.groupSize;
    const paidPerTicketCents =
      seat.chargedAmountCents !== null && offer.groupSize > 0
        ? Math.round(seat.chargedAmountCents / offer.groupSize)
        : offer.pricePerTicketCents;

    // The only honest "under your cap" case: an auto-offer that settled below
    // the cap it authorized.
    const isAutoUnderCap =
      offer.autoBidEnabled && capCents > paidPerTicketCents;
    const underCapDisplay = isAutoUnderCap
      ? formatCents(capCents - paidPerTicketCents)
      : null;

    return {
      ...base,
      kind: "placed",
      state: decidePlacedState(
        seat.tier,
        offer.preferredTier,
        context.tierMinRowRank,
      ),
      seatLine: buildSeatLine(seat, row),
      size: offer.groupSize,
      capDisplay: formatCents(capCents),
      paidPerTicketDisplay: formatCents(paidPerTicketCents),
      chargedTotalDisplay: formatCents(chargedTotalCents),
      isAutoUnderCap,
      underCapDisplay,
      poolCount: context.poolCount,
      capacity: context.capacity,
      // Honestly not computable yet — displacement.ts exposes no queue rank.
      // The card stays omitted until a real position lands.
      moveUpPosition: null,
      ticketReady,
    };
  }

  // Binding seat held but the capture failed — recovery still open. Lead with
  // "you're in"; the deadline + minutes come from the shared recovery
  // presenter (null once the window has lapsed).
  if (offer.status === "card_failure" && seat?.isBinding) {
    const recovery = context.cardFailure;
    return {
      ...base,
      kind: "card_failure",
      size: offer.groupSize,
      seatLine: buildSeatLine(seat, row),
      amountDueDisplay: formatCents(
        offer.pricePerTicketCents * offer.groupSize,
      ),
      deadlineLabel: recovery
        ? formatClock(new Date(recovery.deadlineIso), tz)
        : null,
      minutesLeft: recovery ? recovery.minutesLeft : null,
    };
  }

  // An oversubscribed show left this offer out — auth released, no charge.
  if (offer.status === "unplaced") {
    return {
      ...base,
      kind: "unplaced",
      offerPriceDisplay: formatCents(offer.pricePerTicketCents),
      size: offer.groupSize,
      marginalDisplay:
        context.marginalPlacedCents !== null
          ? formatCents(context.marginalPlacedCents)
          : null,
    };
  }

  return null;
}

// Re-export so callers can keep the seat-preview helper colocated with the
// other presenter usage if they want the combined string instead of the
// split fields.
export { formatSeatAssignmentPreview };
