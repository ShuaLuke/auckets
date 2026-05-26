// FitResolver: scan-ahead helper for LaunchPad.
//
// Spec: docs/GAE_SPEC.md §3 FitResolver.
//
// When LaunchPad's greedy walk hits a compatible offer that doesn't fit
// any of the row's remaining contiguous runs, FitResolver scans forward
// in the rank-ordered pool for the next compatible offer that *does*
// fit. The skipped offers stay in the pool — they'll be considered
// again for the next row.
//
// FitResolver only defers; it never rejects. The caller is responsible
// for actually placing the returned offer, emitting the FIT_RESOLVED
// decision, and shrinking the runs.
//
// Why a separate module from launchpad.ts: the spec calls it out as its
// own concept, and isolating the scan logic makes it independently
// unit-testable without spinning up a full venue / offer pool.

import type { RankedOffer } from "./types";

// Minimal structural type for runs — we only need their length to ask
// "does this group size fit?". LaunchPad's internal Run carries position
// data too, but FitResolver doesn't care; this lets us pass a projected
// view in without coupling the two modules.
export type FitScanRun = { length: number };

export type FitScanResult = {
  // Index into pool of the offer that should be placed, or -1 when no
  // compatible offer downstream fits any run.
  foundIdx: number;
  // Index into runs of the run the placed offer fits in. -1 when
  // foundIdx is -1.
  foundRunIdx: number;
  // Compatible offers between startIdx and foundIdx that did not fit any
  // run. The caller logs these for audit and leaves them in the pool;
  // they're tried again on the next row. Incompatible offers are not
  // included here — they were never candidates for this row in the
  // first place.
  skipped: RankedOffer[];
};

export function scanForwardFit(
  pool: RankedOffer[],
  startIdx: number,
  runs: ReadonlyArray<FitScanRun>,
  isCompatible: (offer: RankedOffer) => boolean,
): FitScanResult {
  const skipped: RankedOffer[] = [];
  for (let i = startIdx; i < pool.length; i++) {
    const offer = pool[i];
    if (offer === undefined) continue;
    if (!isCompatible(offer)) continue;
    const runIdx = runs.findIndex((r) => r.length >= offer.groupSize);
    if (runIdx !== -1) {
      return { foundIdx: i, foundRunIdx: runIdx, skipped };
    }
    skipped.push(offer);
  }
  return { foundIdx: -1, foundRunIdx: -1, skipped };
}
