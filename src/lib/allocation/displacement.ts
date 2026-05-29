// Displacement detection — the pure core of ADR-0018 §4 (fan alerts). Given
// a fan's PRIOR projected placement and their NEW placement from this run
// (plus the auto-bid raises the run produced), it returns the transitions
// worth telling a fan about. No DB, no clock, no env: run-preview/run-binding
// load the prior projection, call this, and persist the result.
//
// Event kinds (mirrors displacement_events.kind):
//   - 'outbid_out'    — was placed, now unplaced (fell out of the event).
//   - 'section_change'— placed before & after, but in a different tier.
//   - 'auto_bid_raise'— an auto-bidder's effective price was raised this run
//     to defend its section, AND it ended placed (a raise that still left the
//     fan unplaced is told as 'outbid_out', not a hollow "we raised you").
//
// Dedup: a persisted projection is re-runnable, so the same auto-raise
// recomputes every run. The caller passes the most-recent persisted raise
// target per offer; an identical raise is suppressed so repeated runs don't
// re-alert. Placement-based events (outbid_out / section_change) are
// inherently deduped — they only fire when the tier actually changes between
// runs.

import type { offers } from "../../../drizzle/schema";

import type { AutoBidRaise } from "./auto-bid";

type Offer = typeof offers.$inferSelect;

// A fan's placement in one projection. Absent from the map = unplaced.
export type Placement = { tier: string | null; venueRowId: string };

export type DisplacementEventKind =
  | "auto_bid_raise"
  | "section_change"
  | "outbid_out";

export type NewDisplacementEvent = {
  offerId: string;
  userId: string;
  kind: DisplacementEventKind;
  detail: Record<string, unknown>;
};

export type DetectDisplacementParams = {
  // Prior persisted preview placement, offerId → placement. Absent = was
  // unplaced (or had no prior projection).
  prevByOffer: ReadonlyMap<string, Placement>;
  // This run's placement, offerId → placement. Absent = unplaced.
  newByOffer: ReadonlyMap<string, Placement>;
  // Auto-bid raises this run produced (submitted → resolved per offer).
  autoBidRaises: readonly AutoBidRaise[];
  // The resolved offers in this run's pool — source of userId + iteration
  // order (deterministic).
  offers: readonly Offer[];
  // Most-recent persisted auto_bid_raise target (toCents) per offer, for
  // dedup. Absent = no prior raise recorded.
  lastRaiseToByOffer: ReadonlyMap<string, number>;
  // Tier ordering for better/worse: higher = better section. A tier not in
  // the map (incl. null / GA) ranks lowest.
  tierRank: (tier: string | null) => number;
};

export function detectDisplacementEvents(
  p: DetectDisplacementParams,
): NewDisplacementEvent[] {
  const events: NewDisplacementEvent[] = [];
  const raiseByOffer = new Map(p.autoBidRaises.map((r) => [r.offerId, r]));

  for (const offer of p.offers) {
    const userId = offer.userId;
    const prev = p.prevByOffer.get(offer.id) ?? null;
    const next = p.newByOffer.get(offer.id) ?? null;

    if (prev && !next) {
      // Fell out of the event entirely.
      events.push({
        offerId: offer.id,
        userId,
        kind: "outbid_out",
        detail: { fromTier: prev.tier },
      });
    } else if (prev && next && prev.tier !== next.tier) {
      // Moved sections (either direction; the fan cares most about 'worse').
      events.push({
        offerId: offer.id,
        userId,
        kind: "section_change",
        detail: {
          fromTier: prev.tier,
          toTier: next.tier,
          direction:
            p.tierRank(next.tier) >= p.tierRank(prev.tier) ? "better" : "worse",
        },
      });
    }

    // Auto-bid raise — only when the offer ended PLACED (a raise that didn't
    // save the fan is told as outbid_out above) and the target changed from
    // the last persisted raise (dedup repeated identical runs).
    const raise = raiseByOffer.get(offer.id);
    if (raise && next && p.lastRaiseToByOffer.get(offer.id) !== raise.toCents) {
      events.push({
        offerId: offer.id,
        userId,
        kind: "auto_bid_raise",
        detail: {
          fromCents: raise.fromCents,
          toCents: raise.toCents,
          steps: raise.steps,
          tier: next.tier,
        },
      });
    }
  }

  return events;
}
