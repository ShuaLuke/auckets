// How much simulation one request to the admin Simulation tab may ask for.
// The route runs inside a 60 s serverless function, so the limit has to
// follow the size of the room: an allocation is ~20 ms at the Lincoln
// (1,265 seats) and ~3.6 s at Daikin Park (41,151 on sale). Pure, and shared
// by the route (which enforces it) and the form (which warns before the run).

export const MAX_ALLOCATIONS = 400;

// Rooms this size or smaller keep the flat allocation cap they always had.
const BIG_ROOM_SEATS = 5000;

// Estimated work allowed per request in a big room, in milliseconds on the
// machine the numbers below were measured on. Vercel is slower; 20 s here
// leaves the function's 60 s limit a wide margin.
export const BIG_ROOM_BUDGET_MS = 20_000;

// Measured 2026-09-20 on the Daikin manifest, one seed, pool 1.25× the
// seats (18,008 offers): greedy 3.6 s, clean-fit 4.5 s,
// clean-fit+singles-reserve 5.4 s, lookahead 10–14 s, lookahead:4 20 s.
// Between the Lincoln and Daikin the time per allocation grows like
// seats^1.4. It grows faster with the crowd: greedy took 0.9 s at 0.6×,
// 3.4 s at 1.25×, 12.8 s at 2.5× and 39 s at 5× — about oversubscription^1.8,
// because every offer that cannot be seated is tried against every row.
const REFERENCE_SEATS = 41_151;
const REFERENCE_OVERSUBSCRIPTION = 1.25;
const REFERENCE_GREEDY_MS = 3600;
const SEATS_GROWTH = 1.4;
const CROWD_GROWTH = 1.8;

export function estimateAllocationMs(onSaleSeats: number, oversubscription: number): number {
  return REFERENCE_GREEDY_MS * Math.pow(Math.max(1, onSaleSeats) / REFERENCE_SEATS, SEATS_GROWTH) * Math.pow(Math.max(0.1, oversubscription) / REFERENCE_OVERSUBSCRIPTION, CROWD_GROWTH);
}

// Cost of a policy relative to greedy.
export function policyWeight(policy: string): number {
  const lookahead = /lookahead(?::(\d+))?/.exec(policy);
  if (lookahead) return 1.5 + Number(lookahead[1] ?? 2);
  if (policy.includes("clean-fit")) return 1.5;
  return 1;
}

export type WorkCheck = { ok: true; allocations: number; estimatedMs: number } | { ok: false; allocations: number; estimatedMs: number; message: string };

// `oversubscription` is tickets asked for ÷ seats on sale.
export function checkWork(input: { onSaleSeats: number; oversubscription: number; policies: string[]; seeds: number; previews: number }): WorkCheck {
  const { onSaleSeats, oversubscription, policies, seeds, previews } = input;
  const allocations = seeds * policies.length * previews;
  const units = seeds * previews * policies.reduce((s, p) => s + policyWeight(p), 0);
  const estimatedMs = units * estimateAllocationMs(onSaleSeats, oversubscription);
  if (allocations > MAX_ALLOCATIONS) {
    return { ok: false, allocations, estimatedMs, message: `that's ${allocations} allocations (seeds × policies × previews); the limit per run is ${MAX_ALLOCATIONS}. Lower the seeds, policies, or preview frequency.` };
  }
  if (onSaleSeats > BIG_ROOM_SEATS && estimatedMs > BIG_ROOM_BUDGET_MS) {
    return {
      ok: false,
      allocations,
      estimatedMs,
      message: `that's about ${Math.round(estimatedMs / 1000)} s of work with ${onSaleSeats.toLocaleString("en-US")} seats on sale; the limit per run is ${BIG_ROOM_BUDGET_MS / 1000} s. Use fewer seeds or policies (lookahead is the expensive one), a smaller crowd, no timeline, or fewer sections on sale. The CLI (npm run sim) has no limit.`,
    };
  }
  return { ok: true, allocations, estimatedMs };
}
