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

// Compose the GAE's VenueArchitecture: rows from venue_architectures
// (already narrowed by the venues repo), activeRowIds from the show
// (which the GAE uses to scope placement to the per-show subset —
// NEW-4 partial-venue activation).
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
