// The old way, so the demo can put it next to ours: every tier at one fixed
// face price (the tier floor), sold in the order fans arrived, best
// available seats to each buyer. This is a plain box-office on-sale — no
// ranking, no offers, no engine — run over the SAME crowd the engine sees,
// so the difference is the allocation and nothing else.
//
// Arrival order is drawn at random (seeded) unless the run says
// "as-submitted": who reaches the box office first has nothing to do with
// what they'd pay, and a pool file's timestamps are often an artifact
// (Cope's sheet numbers offers in price order).
//
// What a fan does, in arrival order:
//   - Looks at the tiers they'd accept (their tier preference), best first.
//   - Buys in the first of those whose face price is at or under what they
//     were willing to pay AND that still has a block of seats for the group.
//   - Pays face. What they were willing to pay above it stays in their
//     pocket (or goes to a reseller — the old way can't tell).
//   - Priced out: face is over their offer in every tier they'd take.
//   - Sold out: they could afford a tier they'd take, but nothing fit them.
//
// Best available = the best-ranked row in the tier with a contiguous block
// for the group, placed by the row's lean the way a box office would sit
// one party. Groups are never split (NEW-6 applies to the comparison too).
//
// Pure: same shape out as the engine (AllocationResult), so metrics, the
// seat map, offers.csv and the invariants all work unchanged.

import { computeStats } from "@/lib/gae";
import { placeInRun } from "@/lib/gae/placement";
import type { AllocationDecision, AllocationResult, RankedOffer, SeatAssignment, TierPreference, UnplacedOffer, VenueArchitecture, VenueRow } from "@/lib/gae/types";

import { createRng } from "./rng";
import { SimInputError } from "./venue";

export const FIRST_COME = "first-come";
export type FirstComeArrival = "random" | "as-submitted";

export type FirstComeOutcome = {
  result: AllocationResult;
  paidCents: Record<string, number>; // offer id → face paid per ticket
  pricedOut: string[]; // offer ids
  soldOut: string[];
};

// Tiers best first, by the best row in each — the same inference Waterfall
// makes, so "this or worse" means the same thing here as in the engine.
function tierOrder(rows: VenueRow[]): string[] {
  const best = new Map<string, number>();
  for (const r of rows) {
    if (r.tier === undefined) continue;
    best.set(r.tier, Math.min(best.get(r.tier) ?? Number.POSITIVE_INFINITY, r.rowRank));
  }
  return [...best.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

function acceptableTiers(pref: TierPreference, order: string[]): string[] {
  if (pref.type === "any") return order;
  const i = order.indexOf(pref.tier);
  if (i === -1) return [];
  if (pref.type === "specific") return [pref.tier];
  if (pref.type === "this_or_worse") return order.slice(i);
  // this_or_better: what they asked for first, then better (dearer) tiers.
  return [pref.tier, ...order.slice(0, i).reverse()];
}

export function allocateFirstCome(arch: VenueArchitecture, offers: RankedOffer[], floorsCents: Record<string, number>, arrival: FirstComeArrival = "random", seed = 1): FirstComeOutcome {
  const active = new Set(arch.activeRowIds);
  const rows = arch.rows.filter((r) => active.has(r.id)).sort((a, b) => a.rowRank - b.rowRank);
  const order = tierOrder(rows);
  for (const t of order) {
    if (floorsCents[t] === undefined) throw new SimInputError(`first-come: no face price for tier "${t}" — set venue.tierFloorsCents or show.floorsCents`);
  }
  const rowsByTier = new Map<string, VenueRow[]>();
  for (const r of rows) if (r.tier !== undefined) rowsByTier.set(r.tier, [...(rowsByTier.get(r.tier) ?? []), r]);

  // Open positions per row: everything not held. Placing removes them.
  const open = new Map<string, Set<number>>();
  for (const r of rows) {
    const held = new Set(r.holds);
    open.set(r.id, new Set(r.seatNumbers.map((s, i) => (held.has(s) ? -1 : i)).filter((i) => i >= 0)));
  }

  // Arrival order. rankKey plays no part. Sorted by id first so a random
  // draw is the same whatever order the pool came in.
  const byId = [...offers].sort((a, b) => a.id.localeCompare(b.id));
  const arrivals = arrival === "random" ? createRng(seed).shuffle(byId) : byId.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id));

  const assignments: SeatAssignment[] = [];
  const unplaced: UnplacedOffer[] = [];
  const decisions: AllocationDecision[] = [];
  const paidCents: Record<string, number> = {};
  const pricedOut: string[] = [];
  const soldOut: string[] = [];

  for (const o of arrivals) {
    const tiers = acceptableTiers(o.tierPreference, order);
    const affordable = tiers.filter((t) => floorsCents[t]! <= o.pricePerTicketCents);
    if (affordable.length === 0) {
      unplaced.push({ offerId: o.id, reason: "no_compatible_tier" });
      pricedOut.push(o.id);
      decisions.push({ action: "SKIPPED", offerId: o.id, reason: `first-come: priced out — offered ${o.pricePerTicketCents} a ticket, face in every tier they'd take is higher`, snapshot: { firstCome: true, pricedOut: true, tiers } });
      continue;
    }
    let seated = false;
    for (const tier of affordable) {
      for (const r of rowsByTier.get(tier) ?? []) {
        const positions = blockFor(r, open.get(r.id)!, o.groupSize);
        if (!positions) continue;
        for (const p of positions) {
          open.get(r.id)!.delete(p);
          assignments.push({ offerId: o.id, venueRowId: r.id, seatNumber: r.seatNumbers[p]!, positionIndex: p });
        }
        paidCents[o.id] = floorsCents[tier]!;
        decisions.push({
          action: "PLACED",
          offerId: o.id,
          venueRowId: r.id,
          reason: `first-come: bought ${o.groupSize} in ${tier} at face ${floorsCents[tier]} (offered ${o.pricePerTicketCents})`,
          snapshot: { firstCome: true, tier, faceCents: floorsCents[tier], offeredCents: o.pricePerTicketCents, rowRank: r.rowRank },
        });
        seated = true;
        break;
      }
      if (seated) break;
    }
    if (!seated) {
      unplaced.push({ offerId: o.id, reason: "no_fit_anywhere" });
      soldOut.push(o.id);
      decisions.push({ action: "SKIPPED", offerId: o.id, reason: `first-come: sold out — could afford ${affordable.join("/")} but no block of ${o.groupSize} was left`, snapshot: { firstCome: true, soldOut: true, affordable } });
    }
  }

  return { result: { assignments, unplaced, decisions, stats: computeStats(arch, offers, assignments, unplaced.length) }, paidCents, pricedOut, soldOut };
}

// The first contiguous run of open seats that holds the group, with the
// group placed in it by the row's lean (a GA pen just takes the next seats).
function blockFor(row: VenueRow, open: Set<number>, size: number): number[] | undefined {
  const sorted = [...open].sort((a, b) => a - b);
  let run: number[] = [];
  for (let k = 0; k <= sorted.length; k++) {
    const p = sorted[k];
    if (p !== undefined && (run.length === 0 || p === run[run.length - 1]! + 1)) {
      run.push(p);
      continue;
    }
    if (run.length >= size) break;
    run = p === undefined ? [] : [p];
  }
  if (run.length < size) return undefined;
  if (row.isGa === true) return run.slice(0, size);
  return placeInRun(run, [{ id: "buyer", groupSize: size }], row.lean)[0]!.positions;
}
