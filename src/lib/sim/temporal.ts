// Temporal simulation (docs/GAE_SIMULATOR.md §4.6). Runs the offer window as
// a sequence of preview allocations, then binding, then the post-binding
// inventory story. Pure and seeded: same scenario + seed → same timeline.
//
// What it measures, and for which open question:
//   displacement / told-in-then-out .... Q3 rolling "Admission Confirmed" vs ADR-0004
//   revisions upward .................... Q12 (fans revise upward; "cannot lower")
//   withdrawals ......................... NEW-9
//   rolling confirmations broken ........ Q3 (measured, never enforced)
//   returns / releases / refill ......... Q4 post-binding inventory
//   booked $ by day vs seated $ ......... Q5 "ring the register"

import { allocate } from "@/lib/gae";
import { computeRankKey } from "@/lib/gae/rankkey";
import type { AllocationConfig, AllocationResult, RankedOffer, VenueArchitecture } from "@/lib/gae/types";

import { resolveAutoBids } from "./autobid";
import { SUBMITTED_BASE_MS } from "./pool";
import { createRng, type Rng } from "./rng";
import type { ArrivalCurve, AutoBids, RaiseRule, TemporalMetrics, TimelineSpec, TimelineTick } from "./types";

export type WindowResult = {
  // The pool as it stands at binding: arrived, not withdrawn, revised prices.
  finalOffers: RankedOffer[];
  finalAutoBids: AutoBids;
  // Everything measured before binding; returns/register-first are
  // completed by finishTimeline() once the binding result exists.
  partial: Omit<TemporalMetrics, "returns" | "registerFirst" | "upgrades"> & {
    bookedByDayCents: number[];
    arrivalHourById: Map<string, number>;
    revisedIds: Set<string>;
    confirmedIds: Set<string>;
    seatedAtFirstPreview: Set<string>;
  };
};

// Arrival time as a fraction of the window, per curve. Draws from `rng`.
export function drawArrival(curve: ArrivalCurve, rng: Rng): number {
  const u = rng.next();
  switch (curve) {
    case "uniform":
      return u;
    case "front-loaded":
      return u * u; // density highest at open
    case "last-day-spike":
      // 60% spread across the window, 40% in the final tenth of it.
      return rng.next() < 0.6 ? u : 0.9 + u * 0.1;
    case "s-curve":
      return (u + rng.next() + rng.next()) / 3; // bell around the middle
  }
}

const ladderOf = (offers: RankedOffer[]): number => {
  // Smallest positive price difference in the pool, floored at $5 — the
  // step fans revise by when the scenario didn't say.
  const prices = [...new Set(offers.map((o) => o.pricePerTicketCents))].sort((a, b) => a - b);
  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < prices.length; i++) step = Math.min(step, prices[i]! - prices[i - 1]!);
  return Number.isFinite(step) && step >= 500 ? step : 500;
};

export function simulateWindow(
  venue: VenueArchitecture,
  offers: RankedOffer[],
  autoBids: AutoBids,
  timeline: TimelineSpec,
  config: AllocationConfig,
  raiseRule: RaiseRule,
  seed: number,
  ladderCents?: number,
): WindowResult {
  const rng = createRng(seed * 7919 + 17); // independent of the pool draw
  const windowHours = timeline.windowDays * 24;
  const every = timeline.previewEveryHours ?? 12;
  const curve = timeline.arrival ?? "uniform";
  const ladder = ladderCents ?? ladderOf(offers);
  const tierByRow = new Map(venue.rows.map((r) => [r.id, r.tier]));
  const tierRank = new Map<string, number>();
  {
    const active = new Set(venue.activeRowIds);
    const minRank = new Map<string, number>();
    for (const r of venue.rows) {
      if (!active.has(r.id) || r.tier === undefined) continue;
      minRank.set(r.tier, Math.min(minRank.get(r.tier) ?? Infinity, r.rowRank));
    }
    [...minRank.entries()].sort((a, b) => a[1] - b[1]).forEach(([t], i) => tierRank.set(t, i));
  }

  // Per-offer timeline state.
  type Fan = {
    offer: RankedOffer;
    arrivalHour: number;
    reviser: boolean;
    revisions: number;
    withdrawAtHour: number | null;
    withdrawn: boolean;
    seatedTier: string | undefined | null; // null = not seated at last tick
    consecutiveSeatedHours: number;
    confirmedAtHour: number | null;
    outEvents: number;
    downEvents: number;
  };
  const fans: Fan[] = offers.map((o) => {
    const arrivalHour = Math.min(windowHours - 1e-6, drawArrival(curve, rng) * windowHours);
    const reviser = timeline.revisions !== undefined && rng.next() * 100 < timeline.revisions.sharePct;
    const withdrawer = timeline.withdrawals !== undefined && rng.next() * 100 < timeline.withdrawals.sharePct;
    return {
      offer: { ...o, submittedAt: new Date(SUBMITTED_BASE_MS + Math.round(arrivalHour * 3600) * 1000) },
      arrivalHour,
      reviser,
      revisions: 0,
      withdrawAtHour: withdrawer ? arrivalHour + rng.next() * (windowHours - arrivalHour) : null,
      withdrawn: false,
      seatedTier: null,
      consecutiveSeatedHours: 0,
      confirmedAtHour: null,
      outEvents: 0,
      downEvents: 0,
    };
  });
  // Distinct submittedAt for tie-breaks: nudge equal seconds by arrival order.
  fans.sort((a, b) => a.arrivalHour - b.arrivalHour);
  fans.forEach((f, i) => {
    f.offer.submittedAt = new Date(SUBMITTED_BASE_MS + Math.round(f.arrivalHour * 3600) * 1000 + i);
  });

  const ticks: TimelineTick[] = [];
  const seatedAtFirstPreview = new Set<string>();
  const bookedByDayCents: number[] = [];
  let outEvents = 0;
  let downEvents = 0;
  let revisionsApplied = 0;
  let addedCents = 0;
  let withdrawn = 0;
  let withdrawnValueCents = 0;
  let wereSeatedWhenTheyLeft = 0;
  let previews = 0;
  const autoRaisedFans = new Set<string>();
  let autoRaises = 0;
  let autoAddedCents = 0;

  const activeFans = (): Fan[] => fans.filter((f) => !f.withdrawn);
  const currentOffers = (hour: number): RankedOffer[] => activeFans().filter((f) => f.arrivalHour <= hour).map((f) => f.offer);

  // Preview ticks at `every` hours; the window closes at windowHours, where
  // binding runs (that final allocation is done by the caller, on finalOffers).
  for (let hour = every; hour < windowHours + 1e-9; hour += every) {
    const isLast = hour + every > windowHours + 1e-9;
    // 1. Withdrawals that fall before this tick.
    let withdrawalsApplied = 0;
    for (const f of fans) {
      if (f.withdrawn || f.withdrawAtHour === null || f.withdrawAtHour > hour) continue;
      f.withdrawn = true;
      withdrawn += 1;
      withdrawalsApplied += 1;
      withdrawnValueCents += f.offer.pricePerTicketCents * f.offer.groupSize;
      if (f.seatedTier !== null) wereSeatedWhenTheyLeft += 1;
      f.seatedTier = null;
      f.consecutiveSeatedHours = 0;
    }
    // 2. Preview allocation over what has arrived.
    const pool = currentOffers(hour);
    let seen = pool;
    if (timeline.autoBidAtPreviews !== false && Object.keys(autoBids).length > 0) {
      const ab = resolveAutoBids(venue, pool, autoBids, raiseRule, config);
      seen = ab.offers;
      // Auto-raises persist into later previews, as in production (the raise
      // is the fan's new price).
      for (const r of ab.raises) {
        const f = fans.find((x) => x.offer.id === r.offerId)!;
        f.offer.pricePerTicketCents = r.toCents;
        f.offer.rankKey = computeRankKey(r.toCents, f.offer.groupSize);
        autoRaisedFans.add(r.offerId);
        autoRaises += r.steps;
        autoAddedCents += (r.toCents - r.fromCents) * f.offer.groupSize;
      }
    }
    const result = allocate(venue, seen, config);
    previews += 1;
    const placedTier = new Map<string, string | undefined>();
    for (const a of result.assignments) if (!placedTier.has(a.offerId)) placedTier.set(a.offerId, tierByRow.get(a.venueRowId));
    // 3. Compare with last tick per fan.
    let tickOut = 0;
    let tickDown = 0;
    let tickRevisions = 0;
    let seatedValueCents = 0;
    for (const f of fans) {
      if (f.withdrawn || f.arrivalHour > hour) continue;
      const now = placedTier.has(f.offer.id) ? placedTier.get(f.offer.id) : null;
      if (now !== null) seatedValueCents += f.offer.pricePerTicketCents * f.offer.groupSize;
      if (previews === 1 && now !== null) seatedAtFirstPreview.add(f.offer.id);
      let displaced = false;
      if (f.seatedTier !== null && now === null) {
        f.outEvents += 1;
        tickOut += 1;
        displaced = true;
      } else if (f.seatedTier !== null && now !== null && f.seatedTier !== undefined && now !== undefined && (tierRank.get(now) ?? 0) > (tierRank.get(f.seatedTier) ?? 0)) {
        f.downEvents += 1;
        tickDown += 1;
        displaced = true;
      }
      // Rolling confirmation clock: consecutive hours seated.
      if (now !== null) {
        f.consecutiveSeatedHours += every;
        if (timeline.rollingConfirmed && f.confirmedAtHour === null && f.consecutiveSeatedHours >= timeline.rollingConfirmed.afterHours) f.confirmedAtHour = hour;
      } else f.consecutiveSeatedHours = 0;
      f.seatedTier = now;
      // Q12: a displaced reviser raises for the next preview.
      if (displaced && f.reviser && !isLast && f.revisions < (timeline.revisions?.maxPerFan ?? 3)) {
        const [lo, hi] = timeline.revisions!.stepsUp;
        const steps = lo + Math.floor(rng.next() * (hi - lo + 1));
        const add = steps * ladder;
        f.offer.pricePerTicketCents += add;
        f.offer.rankKey = computeRankKey(f.offer.pricePerTicketCents, f.offer.groupSize);
        f.revisions += 1;
        tickRevisions += 1;
        addedCents += add * f.offer.groupSize;
        if (autoBids[f.offer.id] && autoBids[f.offer.id]!.capCents < f.offer.pricePerTicketCents) autoBids = { ...autoBids, [f.offer.id]: { ...autoBids[f.offer.id]!, capCents: f.offer.pricePerTicketCents } };
      }
    }
    outEvents += tickOut;
    downEvents += tickDown;
    revisionsApplied += tickRevisions;
    const arrived = fans.filter((f) => f.arrivalHour <= hour).length;
    const active = pool.length;
    const bookedCents = pool.reduce((s, o) => s + o.pricePerTicketCents * o.groupSize, 0);
    const available = result.stats.placedSeats + result.stats.orphanSeats + result.stats.unfilledSeats;
    ticks.push({
      hour,
      arrivedOffers: arrived,
      activeOffers: active,
      placedSeats: result.stats.placedSeats,
      fillRate: available === 0 ? 0 : result.stats.placedSeats / available,
      displacedOut: tickOut,
      displacedDown: tickDown,
      revisionsApplied: tickRevisions,
      withdrawalsApplied,
      bookedCents,
      seatedValueCents,
    });
    const day = Math.min(timeline.windowDays - 1, Math.floor((hour - 1e-9) / 24));
    bookedByDayCents[day] = bookedCents;
  }
  // Fill any day without a tick (e.g. previews every 48h) with the last known value.
  for (let d = 0; d < timeline.windowDays; d++) if (bookedByDayCents[d] === undefined) bookedByDayCents[d] = d > 0 ? bookedByDayCents[d - 1]! : 0;

  const finalFans = activeFans();
  const finalOffers = finalFans.map((f) => f.offer);
  const finalIds = new Set(finalOffers.map((o) => o.id));
  const finalAutoBids: AutoBids = Object.fromEntries(Object.entries(autoBids).filter(([id]) => finalIds.has(id)));
  const displacedFans = fans.filter((f) => f.outEvents + f.downEvents > 0);
  const outFans = fans.filter((f) => f.outEvents > 0);
  const confirmed = fans.filter((f) => f.confirmedAtHour !== null);

  return {
    finalOffers,
    finalAutoBids,
    partial: {
      windowHours,
      previews,
      ticks,
      displacement: {
        outEvents,
        downEvents,
        fansToldInThenOut: outFans.length,
        fansEverDisplaced: displacedFans.length,
        avgOutEventsPerDisplacedFan: outFans.length === 0 ? 0 : outEvents / outFans.length,
        seatedAtFirstPreviewThenUnseatedAtBinding: 0, // finished later
      },
      revisions: {
        revisers: fans.filter((f) => f.reviser).length,
        fansRevised: fans.filter((f) => f.revisions > 0).length,
        revisionsApplied,
        addedCents,
        revisedAndSeatedAtBinding: 0, // finished later
      },
      autoBidDuringWindow: { fansRaised: autoRaisedFans.size, raises: autoRaises, addedCents: autoAddedCents },
      withdrawals: {
        withdrawers: fans.filter((f) => f.withdrawAtHour !== null).length,
        withdrawn,
        withdrawnValueCents,
        wereSeatedWhenTheyLeft,
      },
      rollingConfirmed: timeline.rollingConfirmed
        ? {
            afterHours: timeline.rollingConfirmed.afterHours,
            confirmedFans: confirmed.length,
            confirmedSeats: confirmed.reduce((s, f) => s + f.offer.groupSize, 0),
            brokenConfirmations: 0, // finished later
            brokenValueCents: 0,
            avgHoursToConfirm: confirmed.length === 0 ? 0 : confirmed.reduce((s, f) => s + (f.confirmedAtHour! - f.arrivalHour), 0) / confirmed.length,
          }
        : null,
      bookedByDayCents,
      arrivalHourById: new Map(fans.map((f) => [f.offer.id, f.arrivalHour])),
      revisedIds: new Set(fans.filter((f) => f.revisions > 0).map((f) => f.offer.id)),
      confirmedIds: new Set(confirmed.map((f) => f.offer.id)),
      seatedAtFirstPreview,
    },
  };
}

// After binding: fold the binding result into the pre-binding measurements,
// then play out returns and releases.
export function finishTimeline(
  venue: VenueArchitecture,
  window: WindowResult,
  binding: AllocationResult,
  timeline: TimelineSpec,
  config: AllocationConfig,
  seed: number,
): TemporalMetrics {
  const p = window.partial;
  const offers = window.finalOffers;
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const seatsByOffer = new Map<string, { rowId: string; seats: string[] }>();
  for (const a of binding.assignments) {
    const e = seatsByOffer.get(a.offerId) ?? { rowId: a.venueRowId, seats: [] };
    e.seats.push(a.seatNumber);
    seatsByOffer.set(a.offerId, e);
  }
  const placedIds = new Set(seatsByOffer.keys());
  const value = (o: RankedOffer): number => o.pricePerTicketCents * o.groupSize;

  const broken = [...p.confirmedIds].filter((id) => !placedIds.has(id));
  const rollingConfirmed = p.rollingConfirmed
    ? {
        ...p.rollingConfirmed,
        brokenConfirmations: broken.length,
        brokenValueCents: broken.reduce((s, id) => s + (offerById.get(id) ? value(offerById.get(id)!) : 0), 0),
      }
    : null;

  // Returns and releases (Q4).
  let returns: TemporalMetrics["returns"] = null;
  if (timeline.returns || timeline.releases) {
    const rng = createRng(seed * 104729 + 3);
    const refill = timeline.returns?.refill ?? "keep-pool-live";
    const placedOffers = offers.filter((o) => placedIds.has(o.id));
    const returned = placedOffers.filter(() => timeline.returns !== undefined && rng.next() * 100 < timeline.returns.sharePct);
    const returnedIds = new Set(returned.map((o) => o.id));
    const returnedSeats = returned.reduce((s, o) => s + o.groupSize, 0);
    // Releases: free held seats from the worst-ranked held positions first.
    let releasedSeats = 0;
    const released = new Map<string, Set<string>>();
    if (timeline.releases && timeline.releases.seats > 0) {
      const active = new Set(venue.activeRowIds);
      const rows = venue.rows.filter((r) => active.has(r.id) && r.holds.length > 0).sort((a, b) => b.rowRank - a.rowRank);
      let remaining = timeline.releases.seats;
      for (const r of rows) {
        for (const seat of r.holds) {
          if (remaining === 0) break;
          const set = released.get(r.id) ?? new Set<string>();
          set.add(seat);
          released.set(r.id, set);
          remaining -= 1;
          releasedSeats += 1;
        }
        if (remaining === 0) break;
      }
    }
    // The venue after binding: seats still taken are holds; returned seats and released holds are open.
    const takenRows = venue.rows.map((r) => {
      const holds = new Set(r.holds);
      for (const seat of released.get(r.id) ?? []) holds.delete(seat);
      for (const a of binding.assignments) if (a.venueRowId === r.id && !returnedIds.has(a.offerId)) holds.add(a.seatNumber);
      return { ...r, holds: [...holds] };
    });
    const afterVenue: VenueArchitecture = { ...venue, rows: takenRows };
    const openSeats = returnedSeats + releasedSeats;
    let refilledSeats = 0;
    let refilledOffers = 0;
    let refilledValueCents = 0;
    if (refill === "keep-pool-live" && openSeats > 0) {
      const waiting = offers.filter((o) => !placedIds.has(o.id));
      const again = allocate(afterVenue, waiting, config);
      refilledSeats = again.stats.placedSeats;
      refilledOffers = new Set(again.assignments.map((a) => a.offerId)).size;
      const seatsOf = new Map<string, number>();
      for (const a of again.assignments) seatsOf.set(a.offerId, (seatsOf.get(a.offerId) ?? 0) + 1);
      for (const [id, n] of seatsOf) refilledValueCents += offerById.get(id)!.pricePerTicketCents * n;
    }
    const available = binding.stats.placedSeats + binding.stats.orphanSeats + binding.stats.unfilledSeats + releasedSeats;
    const placedAfter = binding.stats.placedSeats - returnedSeats + refilledSeats;
    const grossPlaced = placedOffers.reduce((s, o) => s + value(o), 0);
    returns = {
      refill,
      returnedOffers: returned.length,
      returnedSeats,
      returnedValueCents: returned.reduce((s, o) => s + value(o), 0),
      releasedSeats,
      refilledSeats,
      refilledOffers,
      refilledValueCents,
      fillAfterReturns: available === 0 ? 0 : placedAfter / available,
      grossAfterReturnsCents: grossPlaced - returned.reduce((s, o) => s + value(o), 0) + refilledValueCents,
    };
  }

  // Q29 upgrade buyouts: a seated fan asks to move up; a same-size holder in
  // a better tier is offered their price + premium; accepted → swap.
  let upgrades: TemporalMetrics["upgrades"] = null;
  if (timeline.upgrades && timeline.upgrades.requestSharePct > 0) {
    const rng = createRng(seed * 15485863 + 11);
    const tierByRow = new Map(venue.rows.map((r) => [r.id, r.tier]));
    const tierRank = new Map<string, number>();
    {
      const active = new Set(venue.activeRowIds);
      const minRank = new Map<string, number>();
      for (const r of venue.rows) if (active.has(r.id) && r.tier !== undefined) minRank.set(r.tier, Math.min(minRank.get(r.tier) ?? Infinity, r.rowRank));
      [...minRank.entries()].sort((a, b) => a[1] - b[1]).forEach(([t], i) => tierRank.set(t, i));
    }
    const seatedList = offers.filter((o) => placedIds.has(o.id));
    const tierOf = (id: string): number => tierRank.get(tierByRow.get(seatsByOffer.get(id)!.rowId) ?? "") ?? 0;
    const taken = new Set<string>(); // holders already bought out
    let requests = 0;
    let matched = 0;
    let accepted = 0;
    let upliftCents = 0;
    for (const o of seatedList) {
      if (taken.has(o.id) || tierOf(o.id) === 0) continue; // already in the best tier
      if (rng.next() * 100 >= timeline.upgrades.requestSharePct) continue;
      requests += 1;
      const target = seatedList.find((h) => !taken.has(h.id) && h.id !== o.id && h.groupSize === o.groupSize && tierOf(h.id) < tierOf(o.id));
      if (!target) continue;
      matched += 1;
      if (rng.next() * 100 >= timeline.upgrades.acceptRatePct) continue;
      accepted += 1;
      taken.add(target.id);
      taken.add(o.id);
      upliftCents += Math.round((target.pricePerTicketCents * timeline.upgrades.premiumPct) / 100) * o.groupSize;
    }
    upgrades = { requests, matched, accepted, upliftCents, holdersMovedDown: accepted };
  }

  const bookedAtClose = offers.reduce((s, o) => s + value(o), 0);
  const seated = offers.filter((o) => placedIds.has(o.id)).reduce((s, o) => s + value(o), 0);
  const unseated = offers.filter((o) => !placedIds.has(o.id));
  const unseatedValue = unseated.reduce((s, o) => s + value(o), 0);

  return {
    windowHours: p.windowHours,
    previews: p.previews,
    ticks: p.ticks,
    displacement: {
      ...p.displacement,
      seatedAtFirstPreviewThenUnseatedAtBinding: [...p.seatedAtFirstPreview].filter((id) => !placedIds.has(id)).length,
    },
    revisions: { ...p.revisions, revisedAndSeatedAtBinding: [...p.revisedIds].filter((id) => placedIds.has(id)).length },
    autoBidDuringWindow: p.autoBidDuringWindow,
    withdrawals: p.withdrawals,
    rollingConfirmed,
    returns,
    upgrades,
    registerFirst: {
      bookedByDayCents: p.bookedByDayCents,
      bookedAtCloseCents: bookedAtClose,
      seatedAtBindingCents: seated,
      acceptedUnseatedOffers: unseated.length,
      acceptedUnseatedValueCents: unseatedValue,
      acceptedUnseatedShareOfBooked: bookedAtClose === 0 ? 0 : unseatedValue / bookedAtClose,
    },
  };
}
