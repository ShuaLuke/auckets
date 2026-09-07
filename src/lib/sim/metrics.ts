// The numbers behind the fill report (docs/GAE_SIMULATOR.md §4.4). Computed
// from the engine's AllocationResult plus the venue and pool it ran on.
// Every money figure is integer cents.

import { sortRankedOffers } from "@/lib/gae/rankkey";
import type { AllocationResult, RankedOffer, TierPreference, VenueRow } from "@/lib/gae/types";

import { median } from "./pool";
import type { AutoBidMetrics, AutoBidRaise, FillMetrics, GroupSizeMetrics, PreferenceMetrics, SimVenue, SliceMetrics } from "./types";
import { activeRows, maxRunLength, tierOrder } from "./venue";

type Placement = { row: VenueRow; seats: number };

// Relaxed tier compatibility — what the offer could ever accept, mirroring
// the engine's waterfall matcher. Used for "could this offer have sat here".
export function compatible(pref: TierPreference, row: VenueRow, tierIdx: Map<string, number>): boolean {
  if (pref.type === "any") return true;
  if (row.tier === undefined) return false;
  const o = tierIdx.get(pref.tier);
  const r = tierIdx.get(row.tier);
  if (o === undefined || r === undefined) return false;
  if (pref.type === "specific") return o === r;
  if (pref.type === "this_or_worse") return r >= o;
  return r <= o;
}

export function computeMetrics(
  venue: SimVenue,
  offers: RankedOffer[],
  result: AllocationResult,
  heldBySource: Record<string, number>,
  runtimeMs: number,
  autoBid: { bidders: number; raises: AutoBidRaise[]; rounds: number } = { bidders: 0, raises: [], rounds: 0 },
): FillMetrics {
  const rows = activeRows(venue);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const order = tierOrder(venue);
  const tierIdx = new Map(order.map((t, i) => [t, i]));
  const offerById = new Map(offers.map((o) => [o.id, o]));

  // Where each placed offer landed.
  const placement = new Map<string, Placement>();
  const placedPerRow = new Map<string, number>();
  for (const a of result.assignments) {
    const row = rowById.get(a.venueRowId);
    if (!row) continue;
    const p = placement.get(a.offerId);
    if (p) p.seats += 1;
    else placement.set(a.offerId, { row, seats: 1 });
    placedPerRow.set(row.id, (placedPerRow.get(row.id) ?? 0) + 1);
  }

  const available = (r: VenueRow): number => r.capacity - r.holds.length;
  const totalSeats = rows.reduce((s, r) => s + r.capacity, 0);
  const heldSeats = rows.reduce((s, r) => s + r.holds.length, 0);
  const availableSeats = totalSeats - heldSeats;

  let rowsFull = 0;
  let rowsPartial = 0;
  let rowsEmpty = 0;
  for (const r of rows) {
    const avail = available(r);
    if (avail === 0) continue;
    const placed = placedPerRow.get(r.id) ?? 0;
    if (placed === 0) rowsEmpty += 1;
    else if (placed === avail) rowsFull += 1;
    else rowsPartial += 1;
  }

  // Slices: tier / area / section.
  const slice = (keyOf: (r: VenueRow) => string): Record<string, SliceMetrics> => {
    const acc = new Map<string, { avail: number; placed: number; offers: number; gross: number; ticketPrices: number[] }>();
    for (const r of rows) {
      const k = keyOf(r);
      const a = acc.get(k) ?? { avail: 0, placed: 0, offers: 0, gross: 0, ticketPrices: [] };
      a.avail += available(r);
      a.placed += placedPerRow.get(r.id) ?? 0;
      acc.set(k, a);
    }
    for (const [offerId, p] of placement) {
      const o = offerById.get(offerId);
      if (!o) continue;
      const a = acc.get(keyOf(p.row))!;
      a.offers += 1;
      a.gross += o.pricePerTicketCents * p.seats;
      for (let i = 0; i < p.seats; i++) a.ticketPrices.push(o.pricePerTicketCents);
    }
    const out: Record<string, SliceMetrics> = {};
    for (const [k, a] of acc) {
      out[k] = {
        availableSeats: a.avail,
        placedSeats: a.placed,
        emptySeats: a.avail - a.placed,
        fillRate: a.avail === 0 ? 0 : a.placed / a.avail,
        offersPlaced: a.offers,
        grossCents: a.gross,
        avgPriceCents: a.placed === 0 ? 0 : Math.round(a.gross / a.placed),
        medianPriceCents: median(a.ticketPrices),
      };
    }
    return out;
  };

  // By group size.
  const byGroupSize: Record<number, GroupSizeMetrics> = {};
  const ranksBySize = new Map<number, number[]>();
  for (const o of offers) {
    const g = (byGroupSize[o.groupSize] ??= {
      offers: 0,
      placed: 0,
      placedRate: 0,
      ticketsRequested: 0,
      ticketsPlaced: 0,
      medianRowRank: null,
      bestRowRank: null,
      worstRowRank: null,
    });
    g.offers += 1;
    g.ticketsRequested += o.groupSize;
    const p = placement.get(o.id);
    if (p) {
      g.placed += 1;
      g.ticketsPlaced += p.seats;
      const list = ranksBySize.get(o.groupSize) ?? [];
      list.push(p.row.rowRank);
      ranksBySize.set(o.groupSize, list);
    }
  }
  for (const [size, g] of Object.entries(byGroupSize)) {
    const ranks = ranksBySize.get(Number(size)) ?? [];
    g.placedRate = g.offers === 0 ? 0 : g.placed / g.offers;
    if (ranks.length > 0) {
      g.medianRowRank = median(ranks);
      g.bestRowRank = Math.min(...ranks);
      g.worstRowRank = Math.max(...ranks);
    }
  }

  // Preference honouring.
  const preference: Record<TierPreference["type"], PreferenceMetrics> = {
    specific: blankPref(),
    this_or_worse: blankPref(),
    this_or_better: blankPref(),
    any: blankPref(),
  };
  for (const o of offers) {
    const pm = preference[o.tierPreference.type];
    pm.offers += 1;
    const p = placement.get(o.id);
    if (!p) {
      pm.unplaced += 1;
      continue;
    }
    if (o.tierPreference.type === "any") {
      pm.placedPreferred += 1;
      continue;
    }
    const want = tierIdx.get(o.tierPreference.tier);
    const got = p.row.tier === undefined ? undefined : tierIdx.get(p.row.tier);
    if (want === undefined || got === undefined || want === got) pm.placedPreferred += 1;
    else if (got > want) pm.placedWorse += 1;
    else pm.placedBetter += 1;
  }

  // Revenue.
  let grossPlacedCents = 0;
  let unplacedValueCents = 0;
  let unplacedFittableValueCents = 0;
  const placedTicketPrices: number[] = [];
  const maxRun = new Map(rows.map((r) => [r.id, maxRunLength(r)]));
  for (const o of offers) {
    const p = placement.get(o.id);
    if (p) {
      grossPlacedCents += o.pricePerTicketCents * p.seats;
      for (let i = 0; i < p.seats; i++) placedTicketPrices.push(o.pricePerTicketCents);
    } else {
      const value = o.pricePerTicketCents * o.groupSize;
      unplacedValueCents += value;
      const fittable = rows.some((r) => compatible(o.tierPreference, r, tierIdx) && maxRun.get(r.id)! >= o.groupSize);
      if (fittable) unplacedFittableValueCents += value;
    }
  }

  // Rank-respect, "subject to fit" (GAE_SPEC §objective). Offer A was passed
  // over if some LOWER-ranked group B sits in a BETTER row, and the block B
  // occupies plus the empty seats touching it could have held A. A single
  // that filled a 1-seat hole has not jumped a pair — the pair never fit
  // that hole — so it does not count. Greedy only produces these through
  // the strict-then-waterfall pass order; fill-first policies (S3) will
  // produce them by design, which is exactly what this measures.
  const ranked = sortRankedOffers(offers);
  const rankIndex = new Map(ranked.map((o, i) => [o.id, i]));
  type Occupant = { idx: number; slack: number; priceCents: number };
  const occupantsByRow = new Map<string, Occupant[]>(); // sorted by idx desc
  {
    const posOccupant = new Map<string, Map<number, string>>();
    for (const a of result.assignments) {
      let m = posOccupant.get(a.venueRowId);
      if (!m) {
        m = new Map();
        posOccupant.set(a.venueRowId, m);
      }
      m.set(a.positionIndex, a.offerId);
    }
    for (const r of rows) {
      const occ = posOccupant.get(r.id);
      if (!occ) continue;
      const held = new Set(r.holds);
      const openAt = (p: number): boolean => p >= 0 && p < r.seatNumbers.length && !held.has(r.seatNumbers[p]!) && !occ.has(p);
      const blocks = new Map<string, { start: number; end: number }>();
      for (const [p, id] of occ) {
        const b = blocks.get(id);
        if (!b) blocks.set(id, { start: p, end: p });
        else {
          if (p < b.start) b.start = p;
          if (p > b.end) b.end = p;
        }
      }
      const list: Occupant[] = [];
      for (const [id, b] of blocks) {
        let slack = b.end - b.start + 1;
        for (let p = b.start - 1; openAt(p); p--) slack++;
        for (let p = b.end + 1; openAt(p); p++) slack++;
        list.push({ idx: rankIndex.get(id)!, slack, priceCents: offerById.get(id)!.pricePerTicketCents });
      }
      list.sort((x, y) => y.idx - x.idx);
      occupantsByRow.set(r.id, list);
    }
  }
  const rowsWithOccupants = rows.filter((r) => occupantsByRow.has(r.id)); // sorted by rowRank
  let passedOver = 0;
  let rowsLostSum = 0;
  let rowsLostMax = 0;
  let priceGapMaxCents = 0;
  let priceGapSumCents = 0;
  const passedOverOfferIds: string[] = [];
  const rowPos = new Map(rows.map((r, i) => [r.id, i]));
  ranked.forEach((o, i) => {
    const p = placement.get(o.id);
    const myRank = p ? p.row.rowRank : Number.POSITIVE_INFINITY;
    for (const r of rowsWithOccupants) {
      if (r.rowRank >= myRank) break;
      if (!compatible(o.tierPreference, r, tierIdx)) continue;
      let culprit: Occupant | undefined;
      for (const b of occupantsByRow.get(r.id)!) {
        if (b.idx <= i) break; // sorted desc: nothing lower-ranked remains
        if (b.slack >= o.groupSize) {
          culprit = b;
          break;
        }
      }
      if (!culprit) continue;
      passedOver += 1;
      passedOverOfferIds.push(o.id);
      if (p) {
        const lost = rowPos.get(p.row.id)! - rowPos.get(r.id)!;
        rowsLostSum += lost;
        if (lost > rowsLostMax) rowsLostMax = lost;
      }
      const gap = o.pricePerTicketCents - culprit.priceCents;
      if (gap > 0) {
        priceGapSumCents += gap;
        if (gap > priceGapMaxCents) priceGapMaxCents = gap;
      }
      break;
    }
  });

  const s = result.stats;
  return {
    capacity: { totalSeats, heldSeats, heldBySource, availableSeats, activeRows: rows.length },
    fill: {
      placedSeats: s.placedSeats,
      fillRate: s.fillRate,
      emptySeats: s.emptySeats,
      orphanSeats: s.orphanSeats,
      unfilledSeats: s.unfilledSeats,
      holesBySize: s.holesBySize,
      oddHoleSeats: s.oddHoleSeats,
      emptySeatsOddRows: s.emptySeatsOddRows,
      emptySeatsEvenRows: s.emptySeatsEvenRows,
      rowsFull,
      rowsPartial,
      rowsEmpty,
    },
    revenue: {
      grossPlacedCents,
      unplacedValueCents,
      unplacedFittableValueCents,
      avgPlacedPriceCents: s.placedSeats === 0 ? 0 : Math.round(grossPlacedCents / s.placedSeats),
      medianPlacedPriceCents: median(placedTicketPrices),
    },
    offers: {
      total: offers.length,
      placed: placement.size,
      unplaced: offers.length - placement.size,
      ticketsRequested: offers.reduce((t, o) => t + o.groupSize, 0),
      ticketsPlaced: s.placedSeats,
    },
    byTier: slice((r) => r.tier ?? "(no tier)"),
    byArea: slice((r) => String(r.area)),
    bySection: slice((r) => `${String(r.area)} / ${r.section}`),
    byGroupSize,
    preference,
    rankRespect: {
      passedOver,
      rowsLostSum,
      rowsLostMax,
      priceGapMaxCents,
      priceGapSumCents,
      fitResolvedDeferrals: result.decisions.filter((d) => d.action === "FIT_RESOLVED").length,
      waterfalled: result.decisions.filter((d) => d.action === "WATERFALLED").length,
      passedOverOfferIds,
    },
    policy: {
      cleanFitDeferrals: result.decisions.filter((d) => d.snapshot.policy === "clean_fit").length,
      seatsSavedByCleanFit: result.decisions.reduce((s, d) => s + (d.snapshot.policy === "clean_fit" ? Number(d.snapshot.strandedSeatsAvoided ?? 0) : 0), 0),
      parityTiebreaks: result.decisions.filter((d) => d.snapshot.parityTiebreak === true).length,
      reservedSinglesPlaced: new Set(result.decisions.filter((d) => d.snapshot.singlesReserve === true && d.offerId).map((d) => d.offerId)).size,
      reservedSinglesUnplaced: 0, // filled in by run.ts, which knows the reserve set
    },
    autoBid: autoBidMetrics(autoBid),
    runtimeMs,
  };
}

function autoBidMetrics(ab: { bidders: number; raises: AutoBidRaise[]; rounds: number }): AutoBidMetrics {
  const raised = ab.raises.length;
  const total = ab.raises.reduce((s, r) => s + (r.toCents - r.fromCents), 0);
  return {
    bidders: ab.bidders,
    raised,
    totalRaiseCents: total,
    maxRaiseCents: ab.raises.reduce((m, r) => Math.max(m, r.toCents - r.fromCents), 0),
    avgStepsPerRaised: raised === 0 ? 0 : ab.raises.reduce((s, r) => s + r.steps, 0) / raised,
    heldSectionAfterRaise: ab.raises.filter((r) => r.heldSection).length,
    cappedOut: ab.raises.filter((r) => !r.heldSection).length,
    rounds: ab.rounds,
  };
}

function blankPref(): PreferenceMetrics {
  return { offers: 0, placedPreferred: 0, placedWorse: 0, placedBetter: 0, unplaced: 0 };
}
