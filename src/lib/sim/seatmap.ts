// The seat map as data, for the Simulation tab's visual (the text seat map in
// report.ts is the download). One entry per physical seat on sale, rows in
// seat-rank order, each occupied seat pointing at the offer that holds it —
// so the page can shade seats by the price paid and name the group on hover.
//
// Pure, and compact on purpose: it rides in the API response next to the
// slimmed RunOutput, so seats are indexes into `offers`, not repeated objects.

import { isAtomicUnit } from "@/lib/gae/launchpad";
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
  unit?: boolean; // a table or box (the engine's isAtomicUnit)
  lean: VenueRow["lean"];
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
      ...(isAtomicUnit(r) && { unit: true }),
      lean: r.lean,
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

// --- seating chart ---------------------------------------------------------
//
// The room as a chart, derived from fields every venue already carries — no
// coordinates, nothing per-venue:
//
//   area     → a level (orchestra, front balcony, …), nearest the stage first
//   section  → a block within the level
//   lean     → which side of the house the block is on. The engine reads
//              seatNumbers as physical left → right and leans a side section
//              toward the centre aisle, so lean RIGHT means house left, lean
//              LEFT means house right, CENTER / DUAL_AISLE the middle.
//   rowName  → rows with the same name in a level share a line, so row A of
//              the left, centre and right orchestra line up as they do in
//              the room.
//
// Tables and boxes (isAtomicUnit) and GA pens aren't rows of a block; they
// come back as standalone units. Real curvature and rake belong to the venue
// builder — this is the schematic a box-office chart shows.

export type ChartSide = "left" | "centre" | "right";
export type ChartSection = { name: string; side: ChartSide; width: number }; // width = widest row, in seats
export type ChartLine = { rowName: string; rows: (number | null)[] }; // per section: index into view.rows
export type ChartUnit = { label: string; row: number };
export type ChartLevel = {
  area: string;
  sections: ChartSection[]; // house left → right
  lines: ChartLine[]; // nearest the stage first
  units: ChartUnit[];
  widthSeats: number; // Σ section widths — what the page sizes cells from
};

export function seatingChart(view: SeatMapView): ChartLevel[] {
  const areas: string[] = [];
  for (const r of view.rows) if (!areas.includes(r.area)) areas.push(r.area); // rows arrive best rank first

  return areas.map((area) => {
    const inArea = view.rows.map((r, i) => ({ r, i })).filter((x) => x.r.area === area);
    const standalone = inArea.filter((x) => x.r.unit === true || x.r.isGa === true);
    const seated = inArea.filter((x) => x.r.unit !== true && x.r.isGa !== true);

    const rowsPerSection = new Map<string, number>();
    for (const x of standalone) rowsPerSection.set(x.r.section, (rowsPerSection.get(x.r.section) ?? 0) + 1);
    const units: ChartUnit[] = standalone.map((x) => ({
      // "BOX A" holds one row called GA1; "tables" holds Table 1…12. Name the
      // unit by whichever of the two actually identifies it.
      label: x.r.isGa === true ? (x.r.section.toLowerCase() === x.r.rowName.toLowerCase() ? x.r.rowName : `${x.r.section} ${x.r.rowName}`) : rowsPerSection.get(x.r.section) === 1 ? x.r.section : x.r.rowName,
      row: x.i,
    }));

    const bySection = new Map<string, { r: SeatMapRow; i: number }[]>();
    for (const x of seated) bySection.set(x.r.section, [...(bySection.get(x.r.section) ?? []), x]);

    let sections = [...bySection.entries()].map(([name, rows]) => {
      const leans = { left: 0, centre: 0, right: 0 };
      for (const x of rows) leans[x.r.lean === "RIGHT" ? "left" : x.r.lean === "LEFT" ? "right" : "centre"]++;
      const side: ChartSide = leans.left > leans.right && leans.left > leans.centre ? "left" : leans.right > leans.left && leans.right > leans.centre ? "right" : "centre";
      return { name, side, width: Math.max(...rows.map((x) => x.r.seats.length)), bestRank: Math.min(...rows.map((x) => x.r.rowRank)) };
    });
    // A lone block, or a level whose blocks all lean the same way, has no
    // aisle to lean toward — centre it rather than shoving it to one side.
    if (new Set(sections.map((s) => s.side)).size === 1) sections = sections.map((s) => ({ ...s, side: "centre" as const }));
    // Better-ranked blocks sit nearer the centre line.
    const order = (side: ChartSide, dir: 1 | -1): typeof sections => sections.filter((s) => s.side === side).sort((a, b) => dir * (a.bestRank - b.bestRank) || a.name.localeCompare(b.name));
    sections = [...order("left", -1), ...order("centre", 1), ...order("right", 1)];

    // One line per row name, nearest the stage first. A name repeated inside
    // one section gets its own line rather than overwriting the first.
    const lineOf = new Map<string, { rowName: string; bestRank: number; rows: (number | null)[] }>();
    sections.forEach((sec, si) => {
      const seen = new Map<string, number>();
      for (const x of bySection.get(sec.name)!) {
        const nth = (seen.get(x.r.rowName) ?? 0) + 1;
        seen.set(x.r.rowName, nth);
        const key = nth === 1 ? x.r.rowName : `${x.r.rowName}#${nth}`;
        const line = lineOf.get(key) ?? { rowName: x.r.rowName, bestRank: x.r.rowRank, rows: sections.map(() => null) };
        line.rows[si] = x.i;
        line.bestRank = Math.min(line.bestRank, x.r.rowRank);
        lineOf.set(key, line);
      }
    });
    const lines = [...lineOf.values()].sort((a, b) => a.bestRank - b.bestRank).map(({ rowName, rows }) => ({ rowName, rows }));

    return {
      area,
      sections: sections.map(({ name, side, width }) => ({ name, side, width })),
      lines,
      units,
      widthSeats: sections.reduce((sum, sec) => sum + sec.width, 0),
    };
  });
}
