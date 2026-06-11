// Pure translations from DB row shapes to GAE input shapes.
//
// The GAE (src/lib/gae/) is isolated per CLAUDE.md "Hard constraints" —
// it doesn't import Drizzle, doesn't know about postgres-js, and only
// consumes the shapes defined in src/lib/gae/types.ts. This module
// bridges: takes the repository's raw row outputs and produces the
// types the GAE accepts.
//
// All functions here are pure. No I/O, no env, no DB. Tested without
// any mock infrastructure.

import type {
  RankedOffer,
  TierPreference,
  VenueArchitecture as GaeVenueArchitecture,
  VenueRow,
} from "@/lib/gae/types";

import type {
  VenueArchitecture as DbVenueArchitecture,
} from "@/lib/db/repositories";

import type { offers, shows } from "../../../drizzle/schema";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

// offers.tier_preference is stored as TEXT (drizzle/schema.ts line 211)
// with values 'specific' | 'this_or_better' | 'this_or_worse' | 'any'.
// For the three tier-bound variants the row also carries
// offers.preferred_tier (text, nullable). The GAE wants a discriminated
// union. We pessimistically default a tier-bound row missing
// preferred_tier to 'any' — it's a schema-shape violation that
// shouldn't happen with Zod-validated submission, but the GAE will
// happily place an "any" offer rather than crashing.
export function toGaeTierPreference(offer: Offer): TierPreference {
  const pref = offer.tierPreference;
  const tier = offer.preferredTier;
  if (pref === "any") return { type: "any" };
  if (pref === "specific" && tier) return { type: "specific", tier };
  if (pref === "this_or_better" && tier) return { type: "this_or_better", tier };
  if (pref === "this_or_worse" && tier) return { type: "this_or_worse", tier };
  return { type: "any" };
}

// offers.rank_key is `bigint` in Drizzle (matching the Postgres bigint
// generated column). Within the offer-submission domain it stays well
// under Number.MAX_SAFE_INTEGER — even a $1,000,000 / 10-seat offer
// only reaches 100,000,000,010, which is comfortably below 2^53. We
// drop to number for the GAE, where the type is number.
export function toGaeRankedOffer(offer: Offer): RankedOffer {
  return {
    id: offer.id,
    userId: offer.userId,
    showId: offer.showId,
    groupSize: offer.groupSize,
    pricePerTicketCents: offer.pricePerTicketCents,
    rankKey: Number(offer.rankKey),
    submittedAt: offer.submittedAt,
    tierPreference: toGaeTierPreference(offer),
  };
}

// Per-show hold rows as read from the `holds` table (structural subset
// of the row shape returned by listHoldsForShow in
// src/lib/db/repositories/holds.ts — typed structurally so this module
// stays free of repo imports and trivially testable).
export type ShowHoldSeats = {
  venueRowId: string;
  seatNumbers: string[];
};

// Merge per-show holds (artist comps, ADA, production — the `holds`
// table) into the building-level manifest holds baked into
// venue_architectures.rows[].holds, producing an architecture whose
// rows' `holds` arrays carry BOTH. Every allocation path (run-preview,
// run-binding, the live projection route) must call this before
// handing the architecture to the GAE — otherwise the engine seats
// (and, at binding, CHARGES) fans into seats the artist held.
//
// The GAE assumes `row.holds` is a duplicate-free subset of
// `row.seatNumbers`: launchpad's contiguousRuns matches holds against
// seat numbers by string equality, and computeStats derives available
// capacity as `capacity - holds.length`. So for any row we touch, the
// merged holds are rebuilt by filtering `seatNumbers` against the held
// set — that dedupes overlaps (a per-show hold over a building hold),
// drops malformed / out-of-range seat references that don't exist in
// the row, and keeps the holds in seat order. Rows without a per-show
// hold are passed through untouched (bit-identical to today's input).
// Holds referencing a venueRowId not in the architecture are ignored —
// there is no seat there to protect. Holds on INACTIVE rows merge
// harmlessly: the GAE never places into inactive rows anyway.
//
// Pure: no I/O, no mutation of the input architecture.
export function mergeShowHoldsIntoArchitecture<
  T extends { rows: VenueRow[] },
>(architecture: T, showHolds: readonly ShowHoldSeats[]): T {
  if (showHolds.length === 0) return architecture;

  const perShowHeldByRow = new Map<string, Set<string>>();
  for (const hold of showHolds) {
    let seats = perShowHeldByRow.get(hold.venueRowId);
    if (!seats) {
      seats = new Set();
      perShowHeldByRow.set(hold.venueRowId, seats);
    }
    for (const seat of hold.seatNumbers) {
      seats.add(seat);
    }
  }

  const rows = architecture.rows.map((row) => {
    const perShow = perShowHeldByRow.get(row.id);
    if (!perShow) return row;
    const held = new Set(row.holds);
    for (const seat of perShow) {
      held.add(seat);
    }
    return {
      ...row,
      holds: row.seatNumbers.filter((seat) => held.has(seat)),
    };
  });

  return { ...architecture, rows };
}

// Compose the GAE's VenueArchitecture: rows from venue_architectures
// (already narrowed by the venues repo), activeRowIds from the show
// (which the GAE uses to scope placement to the per-show subset —
// NEW-4 partial-venue activation).
//
// NOTE: `architecture` must already carry the per-show holds — callers
// up the stack merge the `holds` table in via
// mergeShowHoldsIntoArchitecture before the plan builders run.
export function toGaeVenueArchitecture(
  show: Pick<Show, "activeRowIds">,
  architecture: DbVenueArchitecture,
): GaeVenueArchitecture {
  return {
    venueId: architecture.venueId,
    rows: architecture.rows,
    activeRowIds: show.activeRowIds as string[],
  };
}
