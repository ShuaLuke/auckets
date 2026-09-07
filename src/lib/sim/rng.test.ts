/** @vitest-environment node */
import { describe, expect, it } from "vitest";

import { createRng } from "./rng";

describe("createRng", () => {
  it("is deterministic for a seed and differs across seeds", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const sa = Array.from({ length: 10 }, () => a.next());
    const sb = Array.from({ length: 10 }, () => b.next());
    const sc = Array.from({ length: 10 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });

  it("int stays inclusive within bounds", () => {
    const r = createRng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([3, 4, 5]));
  });

  it("weightedIndex follows the weights and rejects all-zero", () => {
    const r = createRng(9);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[r.weightedIndex([1, 2, 3])]! += 1;
    expect(counts[0]! / 6000).toBeCloseTo(1 / 6, 1);
    expect(counts[2]! / 6000).toBeCloseTo(1 / 2, 1);
    expect(() => r.weightedIndex([0, 0])).toThrow();
    expect(r.weightedIndex([0, 5, 0])).toBe(1);
  });

  it("shuffle is a permutation and leaves the input alone", () => {
    const r = createRng(3);
    const input = [1, 2, 3, 4, 5, 6];
    const out = r.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });
});
