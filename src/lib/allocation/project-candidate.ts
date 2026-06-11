// Pure projection of a CANDIDATE offer (Change 04 — the live dial). Given the
// current pool and a fan's candidate price/size/tier, run the real GAE
// in-memory to find where that fan WOULD land — without writing anything. The
// live composer calls this (debounced, behind a route) as the fan turns the
// dial, so the venue map re-shades to their projected seats.
//
// It reuses buildPreviewAllocationPlan, so the projection is faithful to what
// a real preview/binding run would do (including auto-bid resolution), not an
// approximation. Pure: no DB, no clock, no Stripe — the route supplies `now`.

import type { Offer, VenueArchitecture as DbVenueArchitecture } from "@/lib/db/repositories";

import type { shows } from "../../../drizzle/schema";

import { buildPreviewAllocationPlan } from "./build-plan";

type Show = typeof shows.$inferSelect;

// A fixed synthetic id for the candidate. It never touches the DB — the merged
// pool lives only in memory for the duration of one projection — so colliding
// with a real uuid is harmless, but the all-zero v4 shape makes it obvious in
// any log that this is the projected stand-in.
export const CANDIDATE_OFFER_ID = "00000000-0000-4000-8000-000000000000";

const RANK_KEY_MULTIPLIER = 1000n;

export type CandidateInput = {
  // The caller's own user id — used only to drop their existing pool offer so
  // revising doesn't double-count their seats. Never returned.
  userId: string;
  pricePerTicketCents: number;
  groupSize: number;
  tierPreference: "specific" | "this_or_better" | "this_or_worse" | "any";
  preferredTier: string | null;
  autoBidEnabled: boolean;
  autoBidCapCents: number | null;
  // Tie-break instant: the fan's existing submittedAt when revising (so they
  // keep their place among equal offers), else "now".
  submittedAt: Date;
};

export type CandidateProjection = {
  placed: boolean;
  tier: string | null;
  venueRowId: string | null;
  seatNumbers: string[];
};

function buildSyntheticOffer(show: Show, candidate: CandidateInput): Offer {
  return {
    id: CANDIDATE_OFFER_ID,
    showId: show.id,
    userId: candidate.userId,
    channel: "market",
    groupSize: candidate.groupSize,
    pricePerTicketCents: candidate.pricePerTicketCents,
    tierPreference: candidate.tierPreference,
    preferredTier: candidate.preferredTier,
    rankKey:
      BigInt(candidate.pricePerTicketCents) * RANK_KEY_MULTIPLIER +
      BigInt(candidate.groupSize),
    autoBidEnabled: candidate.autoBidEnabled,
    autoBidCapCents: candidate.autoBidCapCents,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    // Placeholder Stripe refs — never read by the GAE, never persisted.
    stripePaymentMethodId: "pm_candidate",
    stripeSetupIntentId: "seti_candidate",
    stripePaymentIntentId: null,
    status: "pool",
    submittedAt: candidate.submittedAt,
    recoveringAt: null,
    revisedAt: null,
  };
}

export function projectCandidateOffer(
  show: Show,
  architecture: DbVenueArchitecture,
  poolOffers: readonly Offer[],
  candidate: CandidateInput,
): CandidateProjection {
  const synthetic = buildSyntheticOffer(show, candidate);

  // Drop the fan's own existing offer, then add the candidate — so the
  // projection reflects "if my offer were this" rather than "two of me".
  const merged: Offer[] = [
    ...poolOffers.filter((o) => o.userId !== candidate.userId),
    synthetic,
  ];

  const plan = buildPreviewAllocationPlan(show, architecture, merged);
  const row = plan.assignmentRows.find((r) => r.offerId === CANDIDATE_OFFER_ID);
  if (!row) {
    return { placed: false, tier: null, venueRowId: null, seatNumbers: [] };
  }
  return {
    placed: true,
    tier: row.tier,
    venueRowId: row.venueRowId,
    seatNumbers: [...row.seatNumbers],
  };
}
