// Demand model: a seeded generator that turns "what does the crowd look
// like" into a RankedOffer[]. The headline knob is the group-size mix as
// plain percentages of offers (1s, 2s, 3s…). Everything is drawn from the
// seeded RNG, so a scenario + seed reproduces the exact same pool.

import { computeRankKey } from "@/lib/gae/rankkey";
import type { RankedOffer, TierPreference } from "@/lib/gae/types";

import { SUBMITTED_BASE_MS } from "./pool";
import { createRng } from "./rng";
import type { AutoBids, DemandModel, GroupMixPreset, GroupSizeMix, SeatPrefKind, SeatPrefs, TierPreferenceMix } from "./types";
import { SimInputError } from "./venue";

// Percent of OFFERS by group size. `lincoln-v4` is fitted to Cope's 512-offer
// pool (12 singles, 258 pairs, 66 threes, 155 fours, 21 fives).
export const GROUP_MIX_PRESETS: Record<GroupMixPreset, GroupSizeMix> = {
  "even-heavy": { 1: 5, 2: 45, 3: 5, 4: 35, 5: 5, 6: 5 },
  "odd-heavy": { 1: 25, 2: 15, 3: 25, 4: 10, 5: 15, 6: 5, 7: 5 },
  "singles-rich": { 1: 35, 2: 35, 3: 10, 4: 15, 5: 5 },
  couples: { 1: 10, 2: 60, 3: 10, 4: 20 },
  "big-groups": { 1: 5, 2: 20, 3: 10, 4: 25, 5: 10, 6: 15, 7: 5, 8: 5, 9: 2, 10: 3 },
  "lincoln-v4": { 1: 2.3, 2: 50.4, 3: 12.9, 4: 30.3, 5: 4.1 },
};

export const DEFAULT_PREFERENCE_MIX: TierPreferenceMix = {
  specific: 20,
  this_or_worse: 60,
  this_or_better: 5,
  any: 15,
};

export function resolveGroupMix(mix: GroupSizeMix | GroupMixPreset): GroupSizeMix {
  if (typeof mix === "string") return GROUP_MIX_PRESETS[mix];
  return mix;
}

// Parse the CLI form "1:10,2:45,3:10,4:25,5:5,6:5".
export function parseGroupMixArg(arg: string): GroupSizeMix {
  const mix: GroupSizeMix = {};
  for (const part of arg.split(",")) {
    const m = /^\s*(\d+)\s*[:=]\s*([\d.]+)\s*$/.exec(part);
    if (!m) throw new SimInputError(`--group-mix: cannot read "${part}" (want size:percent, e.g. 2:45)`);
    mix[Number(m[1])] = Number(m[2]);
  }
  const total = Object.values(mix).reduce((s, v) => s + v, 0);
  if (Math.abs(total - 100) >= 0.01) throw new SimInputError(`--group-mix: percentages sum to ${total}, must be 100`);
  return mix;
}

export type DemandContext = {
  // best → worst, from tierOrder()
  tierOrder: string[];
  floorsCents: Record<string, number>;
  availableSeats: number;
  maxGroupSize: number;
};

export type GeneratedPool = {
  offers: RankedOffer[];
  // The mix actually drawn, as percent of offers — echoed in the report so
  // the input and the pool can be checked against each other.
  realizedMixPct: GroupSizeMix;
  // offerId → cap, for the auto-bid share of the pool (empty when off).
  autoBids: AutoBids;
  // offerId → aisle | centre | front, for the seat-preference share (empty when off).
  seatPrefs: SeatPrefs;
};

export function generatePool(model: DemandModel, ctx: DemandContext, seedOverride?: number): GeneratedPool {
  const seed = seedOverride ?? model.seed;
  const rng = createRng(seed);
  if (ctx.tierOrder.length === 0) throw new SimInputError("demand model: venue has no active tiered rows");
  for (const tier of ctx.tierOrder) {
    if (ctx.floorsCents[tier] === undefined) {
      throw new SimInputError(
        `demand model: no floor price for tier "${tier}". Set venue.tierFloorsCents or show.floorsCents for: ${ctx.tierOrder.join(", ")}`,
      );
    }
  }

  const mix = resolveGroupMix(model.groupSizeMix);
  const sizes = Object.keys(mix)
    .map(Number)
    .filter((s) => (mix[s] ?? 0) > 0)
    .sort((a, b) => a - b);
  const usable = sizes.filter((s) => s <= ctx.maxGroupSize);
  if (usable.length === 0) throw new SimInputError(`demand model: every group size in the mix exceeds maxGroupSize ${ctx.maxGroupSize}`);
  const sizeWeights = usable.map((s) => mix[s]!);

  const pref = model.tierPreferenceMix ?? DEFAULT_PREFERENCE_MIX;
  const prefKinds: TierPreference["type"][] = ["specific", "this_or_worse", "this_or_better", "any"];
  const prefWeights = prefKinds.map((k) => pref[k]);

  const tierWeights = ctx.tierOrder.map((_, i) => (model.tierChoice === "uniform" ? 1 : Math.pow(0.5, i)));

  const target = Math.round(model.oversubscription * ctx.availableSeats);
  const drawn: { groupSize: number; tier: string; type: TierPreference["type"]; priceCents: number }[] = [];
  let tickets = 0;
  while (tickets < target) {
    const groupSize = usable[rng.weightedIndex(sizeWeights)]!;
    const tier = ctx.tierOrder[rng.weightedIndex(tierWeights)]!;
    const type = prefKinds[rng.weightedIndex(prefWeights)]!;
    const priceCents = drawPrice(model, ctx.floorsCents[tier]!, rng);
    drawn.push({ groupSize, tier, type, priceCents });
    tickets += groupSize;
  }

  // Arrival order is independent of everything else drawn above.
  const order = rng.shuffle(drawn.map((_, i) => i));
  const arrival = new Array<number>(drawn.length);
  order.forEach((idx, pos) => {
    arrival[idx] = pos;
  });

  // Auto-bid share: drawn after the pool so turning it on doesn't reshuffle
  // the offers themselves (same seed → same crowd, with or without auto-bid).
  const autoBids: AutoBids = {};
  const ab = model.autoBid;
  const ladder = model.priceModel.ladderCents ?? 2500;
  const abFlags = drawn.map(() => ab !== undefined && ab.sharePct > 0 && rng.next() * 100 < ab.sharePct);
  const abCaps = drawn.map((d, i) => {
    if (!abFlags[i] || !ab) return 0;
    const mult = ab.capMultiplier[0] + rng.next() * (ab.capMultiplier[1] - ab.capMultiplier[0]);
    const raw = Math.round(d.priceCents * mult);
    return Math.max(d.priceCents + ladder, Math.round(raw / ladder) * ladder);
  });

  const width = String(drawn.length).length;
  const offers: RankedOffer[] = drawn.map((d, i) => {
    const id = `gen-${String(i + 1).padStart(Math.max(4, width), "0")}`;
    const tierPreference: TierPreference = d.type === "any" ? { type: "any" } : { type: d.type, tier: d.tier };
    return {
      id,
      userId: `user-${id}`,
      showId: "sim-show",
      groupSize: d.groupSize,
      pricePerTicketCents: d.priceCents,
      rankKey: computeRankKey(d.priceCents, d.groupSize),
      submittedAt: new Date(SUBMITTED_BASE_MS + arrival[i]! * 1000),
      tierPreference,
    };
  });

  offers.forEach((o, i) => {
    if (abFlags[i]) autoBids[o.id] = { capCents: abCaps[i]!, kind: "auto" };
  });
  // Private offers (ADR-0017): a hidden threshold above the visible price.
  // Drawn after auto-bid, on non-auto-bidders, so the two shares don't overlap.
  const po = model.privateOffers;
  if (po && po.sharePct > 0) {
    offers.forEach((o, i) => {
      if (abFlags[i]) return;
      if (rng.next() * 100 >= po.sharePct) return;
      const mult = po.thresholdMultiplier[0] + rng.next() * (po.thresholdMultiplier[1] - po.thresholdMultiplier[0]);
      const raw = Math.round(o.pricePerTicketCents * mult);
      const threshold = Math.max(o.pricePerTicketCents + ladder, Math.round(raw / ladder) * ladder);
      autoBids[o.id] = { capCents: threshold, kind: "private" };
    });
  }

  // Seat preferences beyond tier — scored only, never enforced (see types.ts).
  const seatPrefs: SeatPrefs = {};
  const sp = model.seatPrefs;
  if (sp && sp.sharePct > 0) {
    const mix = sp.mix ?? { aisle: 40, centre: 40, front: 20 };
    const kinds: SeatPrefKind[] = ["aisle", "centre", "front"];
    const weights = [mix.aisle, mix.centre, mix.front];
    for (const o of offers) {
      if (rng.next() * 100 >= sp.sharePct) continue;
      seatPrefs[o.id] = kinds[rng.weightedIndex(weights)]!;
    }
  }

  const realizedMixPct: GroupSizeMix = {};
  for (const o of offers) realizedMixPct[o.groupSize] = (realizedMixPct[o.groupSize] ?? 0) + 1;
  for (const k of Object.keys(realizedMixPct)) {
    const size = Number(k);
    realizedMixPct[size] = offers.length === 0 ? 0 : (100 * realizedMixPct[size]!) / offers.length;
  }
  return { offers, realizedMixPct, autoBids, seatPrefs };
}

function drawPrice(model: DemandModel, floorCents: number, rng: ReturnType<typeof createRng>): number {
  const pm = model.priceModel;
  const ladder = pm.ladderCents ?? 2500;
  if (pm.kind === "ladder") {
    const mean = pm.meanStepsAboveFloor ?? 3;
    const max = pm.maxStepsAboveFloor ?? 20;
    // Geometric number of steps with the requested mean.
    const p = 1 / (mean + 1);
    const u = rng.next();
    const k = Math.min(max, Math.floor(Math.log(1 - u) / Math.log(1 - p)));
    return floorCents + k * ladder;
  }
  const medianMultiple = pm.medianMultiple ?? 1.3;
  const sigma = pm.sigma ?? 0.35;
  const raw = floorCents * medianMultiple * Math.exp(sigma * rng.normal());
  const steps = Math.max(0, Math.round((raw - floorCents) / ladder));
  return floorCents + steps * ladder;
}
