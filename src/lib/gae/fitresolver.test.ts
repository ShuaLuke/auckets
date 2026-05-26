import { describe, expect, it } from "vitest";

import { scanForwardFit, type FitScanRun } from "./fitresolver";
import { computeRankKey } from "./rankkey";
import type { RankedOffer, TierPreference } from "./types";

function makeOffer(
  id: string,
  groupSize: number,
  opts: { tier?: TierPreference } = {},
): RankedOffer {
  return {
    id,
    userId: `user-${id}`,
    showId: "show-1",
    groupSize,
    pricePerTicketCents: 5000,
    rankKey: computeRankKey(5000, groupSize),
    submittedAt: new Date("2026-01-01T00:00:00Z"),
    tierPreference: opts.tier ?? { type: "any" },
  };
}

const alwaysCompatible = () => true;

describe("scanForwardFit", () => {
  it("returns the offer at startIdx when it fits, with no skips", () => {
    const pool = [makeOffer("A", 4), makeOffer("B", 2)];
    const runs: FitScanRun[] = [{ length: 10 }];

    const result = scanForwardFit(pool, 0, runs, alwaysCompatible);

    expect(result.foundIdx).toBe(0);
    expect(result.foundRunIdx).toBe(0);
    expect(result.skipped).toEqual([]);
  });

  it("scans past an offer that does not fit and returns the next that does", () => {
    const pool = [makeOffer("too-big", 6), makeOffer("fits", 3)];
    const runs: FitScanRun[] = [{ length: 4 }];

    const result = scanForwardFit(pool, 0, runs, alwaysCompatible);

    expect(result.foundIdx).toBe(1);
    expect(result.foundRunIdx).toBe(0);
    expect(result.skipped.map((o) => o.id)).toEqual(["too-big"]);
  });

  it("returns -1 and lists every compatible non-fit when nothing fits", () => {
    const pool = [makeOffer("big-1", 8), makeOffer("big-2", 6)];
    const runs: FitScanRun[] = [{ length: 4 }];

    const result = scanForwardFit(pool, 0, runs, alwaysCompatible);

    expect(result.foundIdx).toBe(-1);
    expect(result.foundRunIdx).toBe(-1);
    expect(result.skipped.map((o) => o.id)).toEqual(["big-1", "big-2"]);
  });

  it("does not include incompatible offers in skipped", () => {
    // Walk past pool[0] (incompatible) silently. pool[1] doesn't fit and
    // IS compatible → goes into skipped. pool[2] fits.
    const pool = [
      makeOffer("wrong-tier", 2, {
        tier: { type: "specific", tier: "premium" },
      }),
      makeOffer("compat-no-fit", 8),
      makeOffer("compat-fits", 3),
    ];
    const runs: FitScanRun[] = [{ length: 4 }];
    const onlyAny = (o: RankedOffer) => o.tierPreference.type === "any";

    const result = scanForwardFit(pool, 0, runs, onlyAny);

    expect(result.foundIdx).toBe(2);
    expect(result.skipped.map((o) => o.id)).toEqual(["compat-no-fit"]);
  });

  it("prefers the first fitting run when several runs could hold the offer", () => {
    const pool = [makeOffer("A", 3)];
    const runs: FitScanRun[] = [{ length: 5 }, { length: 10 }];

    const result = scanForwardFit(pool, 0, runs, alwaysCompatible);

    expect(result.foundRunIdx).toBe(0);
  });

  it("starts the scan at the given startIdx, ignoring earlier pool entries", () => {
    // pool[0] would fit, but startIdx=1 means we never look at it.
    const pool = [makeOffer("would-have-fit", 2), makeOffer("scanned", 3)];
    const runs: FitScanRun[] = [{ length: 4 }];

    const result = scanForwardFit(pool, 1, runs, alwaysCompatible);

    expect(result.foundIdx).toBe(1);
  });

  it("returns no-fit when startIdx is at or past pool length", () => {
    const pool = [makeOffer("A", 2)];
    const runs: FitScanRun[] = [{ length: 10 }];

    expect(scanForwardFit(pool, 1, runs, alwaysCompatible).foundIdx).toBe(-1);
    expect(scanForwardFit(pool, 99, runs, alwaysCompatible).foundIdx).toBe(-1);
  });

  it("returns no-fit when there are no runs at all", () => {
    const pool = [makeOffer("A", 2)];
    const result = scanForwardFit(pool, 0, [], alwaysCompatible);
    expect(result.foundIdx).toBe(-1);
    // Compatible offers that found no run still count as skipped.
    expect(result.skipped.map((o) => o.id)).toEqual(["A"]);
  });

  it("returns no-fit on an empty pool", () => {
    const result = scanForwardFit([], 0, [{ length: 10 }], alwaysCompatible);
    expect(result.foundIdx).toBe(-1);
    expect(result.skipped).toEqual([]);
  });

  it("does not mutate the input pool", () => {
    const pool = [makeOffer("A", 8), makeOffer("B", 3)];
    const snapshot = pool.map((o) => o.id);
    scanForwardFit(pool, 0, [{ length: 4 }], alwaysCompatible);
    expect(pool.map((o) => o.id)).toEqual(snapshot);
  });
});
