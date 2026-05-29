// Auto-bid resolution — the compute-time core of the displacement engine
// (ADR-0018). Pure: no DB, no env, no clock, no Stripe. It runs the GAE
// repeatedly in-memory to settle auto-bidders, but writes nothing.
//
// Rule (ADR-0018, Julia 2026-05-28): when an auto-bid offer is displaced
// from its preferred section, raise it by its increment ($5 default) and
// re-run, repeating until it holds the section again or hits its cap.
// This is the terminating reading of "raise to $5 above the minimum to
// hold your preferred section": prices move in $5 steps and stop the moment
// the section is held (or the cap is reached), so the fan lands on the
// smallest grid price that defends their section. Raises are monotonic and
// cap-bounded, so the fixed-point iteration always terminates.
//
// "Preferred section":
//   - tier-bound prefs (specific / this_or_better / this_or_worse) carry a
//     named `preferredTier` — displaced means "not seated in that exact
//     tier" (waterfalled below it, or unplaced).
//   - "any" prefs have no preferred section — displaced means "unplaced
//     entirely". (An "any" fan who merely waterfalls to a worse tier is
//     content there; we don't spend their money to climb.)
//
// SCOPE (slice 1): this resolves auto-bids for PREVIEW only (the continuous
// projection fans/artists see between checkpoints). It is deliberately NOT
// wired into binding yet: run-binding captures price*groupSize, but the
// offer's PaymentIntent was authorized at the *submitted* amount, so
// capturing an auto-raised amount would exceed the auth. Making auto-bid
// affect binding requires authorizing up to the cap at submission — a
// separate Stripe slice. See ADR-0018 + build-plan.ts.

import { allocate } from "@/lib/gae";
import type { AllocationConfig, VenueRow } from "@/lib/gae/types";

import type { VenueArchitecture as DbVenueArchitecture } from "@/lib/db/repositories";

import type { offers, shows } from "../../../drizzle/schema";

import { toGaeRankedOffer, toGaeVenueArchitecture } from "./translate";

type Offer = typeof offers.$inferSelect;
type Show = typeof shows.$inferSelect;

// One auto-raise outcome, for logging / future displacement alerts.
export type AutoBidRaise = {
  offerId: string;
  userId: string;
  fromCents: number;
  toCents: number;
  // How many increments were applied to get there.
  steps: number;
};

export type ResolveAutoBidsResult = {
  // Working copies of the pool with auto-raised prices + recomputed
  // rankKeys. Offers without auto-bid (or with no headroom) are unchanged.
  offers: Offer[];
  raises: AutoBidRaise[];
};

// Belt-and-suspenders bound on the fixed-point loop. Each productive round
// raises at least one offer by ≥1 increment toward its cap, so the real
// bound is Σ⌈(cap−price)/increment⌉ across auto-bidders; this just guards
// against a pathological config (e.g. a zero increment slipping through).
const MAX_ROUNDS = 1000;

const RANK_KEY_PRICE_MULTIPLIER = 1000n;

export function resolveAutoBids(
  show: Pick<Show, "activeRowIds">,
  architecture: DbVenueArchitecture,
  poolOffers: readonly Offer[],
  config: AllocationConfig,
): ResolveAutoBidsResult {
  const working: Offer[] = poolOffers.map((o) => ({ ...o }));

  // No active auto-bidders → nothing to resolve; skip the GAE passes.
  const hasAutoBidders = working.some(
    (o) => o.autoBidEnabled && o.autoBidCapCents !== null,
  );
  if (!hasAutoBidders) {
    return { offers: working, raises: [] };
  }

  const venue = toGaeVenueArchitecture(show, architecture);
  const tierByRowId = new Map<string, string | undefined>();
  for (const row of architecture.rows as readonly VenueRow[]) {
    tierByRowId.set(row.id, row.tier);
  }

  const startPriceById = new Map(
    working.map((o) => [o.id, o.pricePerTicketCents]),
  );

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = allocate(venue, working.map(toGaeRankedOffer), config);

    // offerId → the tier of the row it was placed in (a group shares one
    // row, so the first assignment is representative). Absent key = unplaced.
    const placedTierByOffer = new Map<string, string | undefined>();
    for (const a of result.assignments) {
      if (!placedTierByOffer.has(a.offerId)) {
        placedTierByOffer.set(a.offerId, tierByRowId.get(a.venueRowId));
      }
    }

    let changed = false;
    for (const offer of working) {
      if (!offer.autoBidEnabled) continue;
      const cap = offer.autoBidCapCents;
      if (cap === null) continue;
      const increment = offer.autoBidIncrementCents;
      if (increment <= 0) continue;

      const isPlaced = placedTierByOffer.has(offer.id);
      const placedTier = placedTierByOffer.get(offer.id);
      const preferredTier = offer.preferredTier; // null for "any"

      const displaced = preferredTier
        ? !isPlaced || placedTier !== preferredTier
        : !isPlaced;
      if (!displaced) continue;

      const next = offer.pricePerTicketCents + increment;
      if (next > cap) continue; // out of headroom — hold at current price

      offer.pricePerTicketCents = next;
      offer.rankKey =
        BigInt(next) * RANK_KEY_PRICE_MULTIPLIER + BigInt(offer.groupSize);
      changed = true;
    }

    if (!changed) break;
  }

  const raises: AutoBidRaise[] = [];
  for (const offer of working) {
    const from = startPriceById.get(offer.id);
    if (from === undefined || offer.pricePerTicketCents === from) continue;
    raises.push({
      offerId: offer.id,
      userId: offer.userId,
      fromCents: from,
      toCents: offer.pricePerTicketCents,
      steps: (offer.pricePerTicketCents - from) / offer.autoBidIncrementCents,
    });
  }

  return { offers: working, raises };
}
