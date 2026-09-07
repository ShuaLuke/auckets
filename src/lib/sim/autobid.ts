// Auto-bid resolution for the simulator, mirroring src/lib/allocation/
// auto-bid.ts (ADR-0018) on the sim's RankedOffer pool: run the engine,
// raise every displaced auto-bidder by one increment (≤ cap), repeat until
// nothing moves. "Displaced" = not seated in the exact preferred tier for
// tier-bound preferences, unplaced for "any". The production rule is a
// fixed $5 step; Cope prefers a percentage (NEW-13) — both are here so the
// question can be settled with numbers.

import { allocate } from "@/lib/gae";
import { computeRankKey } from "@/lib/gae/rankkey";
import type { AllocationConfig, RankedOffer, VenueArchitecture } from "@/lib/gae/types";

import type { AutoBidRaise, AutoBids, RaiseRule } from "./types";

export const DEFAULT_RAISE_RULE: RaiseRule = { kind: "fixed", cents: 500 };
const MAX_ROUNDS = 1000;

export function incrementFor(rule: RaiseRule, priceCents: number): number {
  if (rule.kind === "fixed") return rule.cents;
  // Percentage of the current price, rounded UP to whole dollars so the
  // raise is always a visible, chargeable step.
  return Math.max(100, Math.ceil((priceCents * rule.pct) / 100 / 100) * 100);
}

export type AutoBidResolution = {
  offers: RankedOffer[];
  raises: AutoBidRaise[];
  rounds: number;
};

export function resolveAutoBids(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  autoBids: AutoBids,
  rule: RaiseRule,
  config: AllocationConfig,
): AutoBidResolution {
  const bidderIds = Object.keys(autoBids).filter((id) => offers.some((o) => o.id === id));
  if (bidderIds.length === 0) return { offers, raises: [], rounds: 0 };

  const tierByRow = new Map(venue.rows.map((r) => [r.id, r.tier]));
  const working = offers.map((o) => ({ ...o }));
  const byId = new Map(working.map((o) => [o.id, o]));
  const start = new Map(working.map((o) => [o.id, o.pricePerTicketCents]));
  const steps = new Map<string, number>();
  let rounds = 0;
  let lastPlacedTier = new Map<string, string | undefined>();

  const placedTiers = (): Map<string, string | undefined> => {
    const result = allocate(venue, working, config);
    const m = new Map<string, string | undefined>();
    for (const a of result.assignments) if (!m.has(a.offerId)) m.set(a.offerId, tierByRow.get(a.venueRowId));
    return m;
  };
  const displaced = (o: RankedOffer, placed: Map<string, string | undefined>): boolean => {
    const pref = o.tierPreference;
    if (pref.type === "any") return !placed.has(o.id);
    return !placed.has(o.id) || placed.get(o.id) !== pref.tier;
  };

  for (; rounds < MAX_ROUNDS; rounds++) {
    lastPlacedTier = placedTiers();
    let changed = false;
    for (const id of bidderIds) {
      const o = byId.get(id)!;
      if (!displaced(o, lastPlacedTier)) continue;
      const next = o.pricePerTicketCents + incrementFor(rule, o.pricePerTicketCents);
      if (next > autoBids[id]!.capCents) continue;
      o.pricePerTicketCents = next;
      o.rankKey = computeRankKey(next, o.groupSize);
      steps.set(id, (steps.get(id) ?? 0) + 1);
      changed = true;
    }
    if (!changed) break;
  }

  const raises: AutoBidRaise[] = [];
  for (const id of bidderIds) {
    const o = byId.get(id)!;
    const from = start.get(id)!;
    if (o.pricePerTicketCents === from) continue;
    raises.push({ offerId: id, kind: autoBids[id]!.kind ?? "auto", fromCents: from, toCents: o.pricePerTicketCents, steps: steps.get(id) ?? 0, heldSection: !displaced(o, lastPlacedTier) });
  }
  return { offers: working, raises, rounds };
}
