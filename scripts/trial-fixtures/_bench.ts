// Throwaway micro-bench: how long does the PURE GAE take as the offer pool
// grows? No DB, no Stripe — just allocate() over synthetic pools, to see
// whether engine compute time is worth instrumenting in production.
import { allocate } from "../../src/lib/gae/index";
import { computeRankKey } from "../../src/lib/gae/rankkey";
import type {
  AllocationConfig,
  RankedOffer,
  VenueArchitecture,
  VenueRow,
} from "../../src/lib/gae/types";

function range(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i));
}
const ROWS: VenueRow[] = [
  { id: "row_a", area: "orchestra", section: "main", rowName: "A", rowRank: 1, capacity: 8, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 8), holds: [], tier: "premium", isGa: false },
  { id: "row_b", area: "orchestra", section: "main", rowName: "B", rowRank: 2, capacity: 8, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 8), holds: [], tier: "premium", isGa: false },
  { id: "row_c", area: "orchestra", section: "main", rowName: "C", rowRank: 3, capacity: 6, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 6), holds: [], tier: "mid", isGa: false },
  { id: "row_d", area: "orchestra", section: "main", rowName: "D", rowRank: 4, capacity: 6, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 6), holds: [], tier: "mid", isGa: false },
  { id: "row_ga", area: "ga", section: "ga", rowName: "GA", rowRank: 5, capacity: 22, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 22).map((n) => `GA-${n}`), holds: [], tier: "ga", isGa: true },
];
const VENUE: VenueArchitecture = { venueId: "bench", rows: ROWS, activeRowIds: ROWS.map((r) => r.id) };
const CONFIG: AllocationConfig = { mode: "preview", allowOrphans: false, maxGroupSize: 10, orphanPolicy: "leave" };
const tiers = ["premium", "premium-", "mid", "mid+", "ga", "any"] as const;

function makeOffers(n: number): RankedOffer[] {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => {
    const groupSize = (i % 8) + 1;
    const cents = (100 - (i % 90)) * 100;
    const t = tiers[i % tiers.length]!;
    const pref =
      t === "any" ? { type: "any" as const }
      : t.endsWith("-") ? { type: "this_or_worse" as const, tier: t.slice(0, -1) }
      : t.endsWith("+") ? { type: "this_or_better" as const, tier: t.slice(0, -1) }
      : { type: "specific" as const, tier: t };
    return { id: `b${i}`, userId: `u${i}`, showId: "bench", groupSize, pricePerTicketCents: cents, rankKey: computeRankKey(cents, groupSize), submittedAt: new Date(base + i), tierPreference: pref };
  });
}

for (const n of [50, 500, 5000, 50000]) {
  const offers = makeOffers(n);
  const iters = n >= 5000 ? 20 : 200;
  // warmup
  allocate(VENUE, offers, CONFIG);
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < iters; k++) allocate(VENUE, offers, CONFIG);
  const t1 = process.hrtime.bigint();
  const msPerRun = Number(t1 - t0) / 1e6 / iters;
  console.log(`  ${String(n).padStart(6)} offers → ${msPerRun.toFixed(3)} ms/run  (avg of ${iters})`);
}
