// The seat map as data, for the Simulation tab's visual (the text seat map in
// report.ts is the download). One entry per physical seat on sale, rows in
// seat-rank order, each occupied seat pointing at the offer that holds it —
// so the page can shade seats by the price paid and name the group on hover.
//
// Pure, and compact on purpose: it rides in the API response next to the
// slimmed RunOutput, so seats are indexes into `offers`, not repeated objects.

import type { RankedOffer, VenueRow } from "@/lib/gae/types";

import { formatTierPref } from "./pool";
import type { PolicyRun, SimVenue } from "./types";
import { activeRows, tierOrder } from "./venue";

export type PlacementOutcome = "placed" | "preferred tier" | "waterfalled down" | "moved up";

// Where an offer landed relative to the tier it named. `any` offers are just
// "placed"; rows or preferences without a known tier count as preferred.
export function placementOutcome(offer: RankedOffer, row: VenueRow, tierIdx: Map<string, number>): PlacementOutcome {
  if (offer.tierPreference.type === "any") return "placed";
  const want = tierIdx.get(offer.tierPreference.tier);
  const got = row.tier === undefined ? undefined : tierIdx.get(row.tier);
  if (want === undefined || got === undefined || want === got) return "preferred tier";
  return got > want ? "waterfalled down" : "moved up";
}

export const SEAT_EMPTY = -1;
export const SEAT_HELD = -2;

export type SeatMapOffer = {
  id: string;
  offerRank: number; // 1 = the highest-ranked offer in the pool
  groupSize: number;
  priceCents: number; // per ticket, as the engine saw it (after any auto-bid raise)
  raisedFromCents?: number; // present when auto-bid moved the price
  preference: string;
  outcome: PlacementOutcome;
};

export type SeatMapRow = {
  id: string;
  rowRank: number;
  area: string;
  section: string;
  rowName: string;
  tier?: string;
  isGa?: boolean;
  seatNumbers: string[];
  // Parallel to seatNumbers: an index into `offers`, SEAT_EMPTY, or SEAT_HELD.
  seats: number[];
};

export type SeatMapView = {
  policy: string;
  seed: number;
  rows: SeatMapRow[];
  offers: SeatMapOffer[]; // seated offers only, best rank first
  totalOffers: number;
  placedSeats: number;
  emptySeats: number;
  heldSeats: number;
};

// null when the run carries no engine output (only the first seed of each
// policy keeps it — see PolicyRun.result).
export function buildSeatMapView(run: PolicyRun, venue: SimVenue): SeatMapView | null {
  const result = run.result;
  const pool = run.offers;
  if (!result || !pool) return null;

  const rows = activeRows(venue);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const tierIdx = new Map(tierOrder(venue).map((t, i) => [t, i]));
  const raisedFrom = new Map((run.raises ?? []).map((r) => [r.offerId, r.fromCents]));

  // Same ordering as offers.csv, so "offer #12" means the same thing in both.
  const ranked = [...pool].sort((a, b) => b.rankKey - a.rankKey || a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id));
  const rowOfOffer = new Map<string, string>();
  for (const a of result.assignments) if (!rowOfOffer.has(a.offerId)) rowOfOffer.set(a.offerId, a.venueRowId);

  const offers: SeatMapOffer[] = [];
  const indexOf = new Map<string, number>();
  ranked.forEach((o, i) => {
    const rowId = rowOfOffer.get(o.id);
    const row = rowId === undefined ? undefined : rowById.get(rowId);
    if (!row) return;
    const from = raisedFrom.get(o.id);
    indexOf.set(o.id, offers.length);
    offers.push({
      id: o.id,
      offerRank: i + 1,
      groupSize: o.groupSize,
      priceCents: o.pricePerTicketCents,
      ...(from !== undefined && from !== o.pricePerTicketCents && { raisedFromCents: from }),
      preference: formatTierPref(o.tierPreference),
      outcome: placementOutcome(o, row, tierIdx),
    });
  });

  const occupant = new Map<string, number>(); // rowId#pos → offer index
  for (const a of result.assignments) {
    const idx = indexOf.get(a.offerId);
    if (idx !== undefined) occupant.set(`${a.venueRowId}#${a.positionIndex}`, idx);
  }

  let placedSeats = 0;
  let emptySeats = 0;
  let heldSeats = 0;
  const viewRows: SeatMapRow[] = rows.map((r) => {
    const held = new Set(r.holds);
    const seats = r.seatNumbers.map((seat, i) => {
      if (held.has(seat)) {
        heldSeats++;
        return SEAT_HELD;
      }
      const idx = occupant.get(`${r.id}#${i}`);
      if (idx === undefined) {
        emptySeats++;
        return SEAT_EMPTY;
      }
      placedSeats++;
      return idx;
    });
    return {
      id: r.id,
      rowRank: r.rowRank,
      area: String(r.area),
      section: r.section,
      rowName: r.rowName,
      ...(r.tier !== undefined && { tier: r.tier }),
      ...(r.isGa && { isGa: true }),
      seatNumbers: r.seatNumbers,
      seats,
    };
  });

  return { policy: run.policy, seed: run.seed, rows: viewRows, offers, totalOffers: pool.length, placedSeats, emptySeats, heldSeats };
}

// --- price scale -----------------------------------------------------------

export type PriceBin = { minCents: number; maxCents: number; seats: number };

// Offer prices pile up near the floor with a long tail, so a linear colour
// scale paints almost every seat the same shade. Bin by quantile over SEATS
// instead: each step covers roughly the same number of seats, and a price
// never straddles two bins. Returned cheapest first.
export function priceBins(view: SeatMapView, maxBins = 5): PriceBin[] {
  const seatsAtPrice = new Map<number, number>();
  for (const o of view.offers) seatsAtPrice.set(o.priceCents, (seatsAtPrice.get(o.priceCents) ?? 0) + o.groupSize);
  const prices = [...seatsAtPrice.keys()].sort((a, b) => a - b);
  if (prices.length === 0) return [];
  const total = [...seatsAtPrice.values()].reduce((s, v) => s + v, 0);
  const binCount = Math.min(maxBins, prices.length);

  const bins: PriceBin[] = [];
  let cumulative = 0;
  let current: PriceBin | undefined;
  prices.forEach((price, i) => {
    const seats = seatsAtPrice.get(price)!;
    if (!current) current = { minCents: price, maxCents: price, seats: 0 };
    current.maxCents = price;
    current.seats += seats;
    cumulative += seats;
    const pricesLeft = prices.length - i - 1;
    const binsLeft = binCount - bins.length - 1;
    // Close the bin once it has its share of seats — or when every remaining
    // price is needed to give each remaining bin at least one.
    if (binsLeft > 0 && (cumulative >= (total * (bins.length + 1)) / binCount || pricesLeft <= binsLeft)) {
      bins.push(current);
      current = undefined;
    }
  });
  if (current) bins.push(current);
  return bins;
}

export function binIndexFor(bins: PriceBin[], priceCents: number): number {
  const i = bins.findIndex((b) => priceCents <= b.maxCents);
  return i === -1 ? bins.length - 1 : i;
}
