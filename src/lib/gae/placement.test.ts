import { describe, expect, it } from "vitest";

import {
  placeInRun,
  type PlacementGroup,
  type RunPlacement,
} from "./placement";

// Most tests work against a contiguous run [0..N-1]. Tests that exercise
// the "skip held seats" behavior pass a non-contiguous positions array
// (e.g. [0, 1, 2, 5, 6, 7] for a run that straddles a hold) and check
// that the held indices never appear in any placement.

const g = (id: string, groupSize: number): PlacementGroup => ({ id, groupSize });

function positionsOf(result: RunPlacement[], id: string): number[] {
  return result.find((r) => r.offerId === id)?.positions ?? [];
}

describe("placeInRun — LEFT", () => {
  it("places groups front-to-back in rank order", () => {
    const result = placeInRun([0, 1, 2, 3, 4, 5], [g("a", 2), g("b", 3)], "LEFT");
    expect(positionsOf(result, "a")).toEqual([0, 1]);
    expect(positionsOf(result, "b")).toEqual([2, 3, 4]);
  });

  it("handles a non-contiguous run by skipping held position indices", () => {
    // Run straddles a hold: positions [0, 1, 2, 5, 6, 7] — indices 3 and
    // 4 are held and never appear in the run array.
    const result = placeInRun([0, 1, 2, 5, 6, 7], [g("a", 4)], "LEFT");
    expect(positionsOf(result, "a")).toEqual([0, 1, 2, 5]);
  });
});

describe("placeInRun — RIGHT", () => {
  it("places best-rank at the right end, others extending leftward", () => {
    const result = placeInRun(
      [0, 1, 2, 3, 4, 5, 6, 7],
      [g("a", 2), g("b", 3)],
      "RIGHT",
    );
    expect(positionsOf(result, "a")).toEqual([6, 7]);
    expect(positionsOf(result, "b")).toEqual([3, 4, 5]);
  });
});

describe("placeInRun — CENTER", () => {
  it("places a single group centered in the run", () => {
    // Run of 8, group of 4 → cluster occupies positions[2..5].
    const result = placeInRun([0, 1, 2, 3, 4, 5, 6, 7], [g("only", 4)], "CENTER");
    expect(positionsOf(result, "only")).toEqual([2, 3, 4, 5]);
  });

  it("places the best-ranked group in the middle of the cluster", () => {
    // Three equal groups of 4 fill a run of 12 exactly.
    // Layout order (left-to-right): [rank-1, rank-0, rank-2].
    const result = placeInRun(
      Array.from({ length: 12 }, (_, i) => i),
      [g("rank-0", 4), g("rank-1", 4), g("rank-2", 4)],
      "CENTER",
    );
    expect(positionsOf(result, "rank-1")).toEqual([0, 1, 2, 3]);
    expect(positionsOf(result, "rank-0")).toEqual([4, 5, 6, 7]);
    expect(positionsOf(result, "rank-2")).toEqual([8, 9, 10, 11]);
  });

  it("alternates outward for 5+ groups: [rank-3, rank-1, rank-0, rank-2, rank-4]", () => {
    const result = placeInRun(
      Array.from({ length: 10 }, (_, i) => i),
      [g("r0", 2), g("r1", 2), g("r2", 2), g("r3", 2), g("r4", 2)],
      "CENTER",
    );
    expect(positionsOf(result, "r3")).toEqual([0, 1]);
    expect(positionsOf(result, "r1")).toEqual([2, 3]);
    expect(positionsOf(result, "r0")).toEqual([4, 5]);
    expect(positionsOf(result, "r2")).toEqual([6, 7]);
    expect(positionsOf(result, "r4")).toEqual([8, 9]);
  });

  it("centers the cluster within the run when groups underfill it", () => {
    // Run of 10, groups summing to 6 → 2 empty positions on each side.
    const result = placeInRun(
      Array.from({ length: 10 }, (_, i) => i),
      [g("a", 4), g("b", 2)],
      "CENTER",
    );
    // Layout: [rank-1, rank-0] left-to-right. Total 6 placed; offset = 2.
    expect(positionsOf(result, "b")).toEqual([2, 3]); // rank-1, leftmost in cluster
    expect(positionsOf(result, "a")).toEqual([4, 5, 6, 7]); // rank-0, center
  });

  it("when the spare gap is odd, the extra seat goes to the right of the cluster", () => {
    // Run of 7, group of 4 → spare = 3. leftPadding = floor(3/2) = 1.
    // Cluster occupies positions[1..4], leaving 0 on the left and 5, 6 on
    // the right.
    const result = placeInRun([0, 1, 2, 3, 4, 5, 6], [g("only", 4)], "CENTER");
    expect(positionsOf(result, "only")).toEqual([1, 2, 3, 4]);
  });
});

describe("placeInRun — DUAL_AISLE", () => {
  it("places best at left aisle, second at right aisle, rest alternating inward", () => {
    const result = placeInRun(
      Array.from({ length: 12 }, (_, i) => i),
      [g("r0", 3), g("r1", 3), g("r2", 3), g("r3", 3)],
      "DUAL_AISLE",
    );
    expect(positionsOf(result, "r0")).toEqual([0, 1, 2]);
    expect(positionsOf(result, "r1")).toEqual([9, 10, 11]);
    expect(positionsOf(result, "r2")).toEqual([3, 4, 5]);
    expect(positionsOf(result, "r3")).toEqual([6, 7, 8]);
  });

  it("places a lone group at the left aisle (i=0 always goes left)", () => {
    const result = placeInRun([0, 1, 2, 3, 4], [g("only", 2)], "DUAL_AISLE");
    expect(positionsOf(result, "only")).toEqual([0, 1]);
  });
});

describe("placeInRun — degenerate inputs", () => {
  it("returns an empty array when there are no groups", () => {
    expect(placeInRun([0, 1, 2, 3], [], "CENTER")).toEqual([]);
    expect(placeInRun([0, 1, 2, 3], [], "LEFT")).toEqual([]);
    expect(placeInRun([0, 1, 2, 3], [], "RIGHT")).toEqual([]);
    expect(placeInRun([0, 1, 2, 3], [], "DUAL_AISLE")).toEqual([]);
  });

  it("preserves group identity even when sizes are zero (defensive — shouldn't happen)", () => {
    // groupSize === 0 isn't realistic input but the algorithm shouldn't crash.
    const result = placeInRun([0, 1, 2, 3], [g("zero", 0)], "LEFT");
    expect(positionsOf(result, "zero")).toEqual([]);
  });
});
