import { describe, expect, it } from "vitest";

import type { PriceDistributionBucket } from "@/lib/db/repositories";

import { presentPriceDistribution } from "./distribution";

describe("presentPriceDistribution", () => {
  it("returns 10 zero-count buckets when the pool is empty", () => {
    const view = presentPriceDistribution([]);
    expect(view.buckets).toHaveLength(10);
    expect(view.total).toBe(0);
    expect(view.maxCount).toBe(0);
    expect(view.buckets.every((b) => b.count === 0 && b.share === 0)).toBe(true);
  });

  it("maps each bucketIndex to its label position", () => {
    const rows: PriceDistributionBucket[] = [
      { bucketIndex: 0, count: 3 },
      { bucketIndex: 6, count: 10 },
      { bucketIndex: 9, count: 1 },
    ];
    const view = presentPriceDistribution(rows);
    expect(view.buckets[0]?.label).toBe("<$15");
    expect(view.buckets[0]?.count).toBe(3);
    expect(view.buckets[6]?.label).toBe("$40-50");
    expect(view.buckets[6]?.count).toBe(10);
    expect(view.buckets[9]?.label).toBe("$100+");
    expect(view.buckets[9]?.count).toBe(1);
    // Buckets without rows stay 0.
    expect(view.buckets[3]?.count).toBe(0);
  });

  it("computes total and maxCount across all buckets", () => {
    const view = presentPriceDistribution([
      { bucketIndex: 2, count: 4 },
      { bucketIndex: 4, count: 7 },
      { bucketIndex: 7, count: 2 },
    ]);
    expect(view.total).toBe(13);
    expect(view.maxCount).toBe(7);
  });

  it("computes share-of-pool as count / total", () => {
    const view = presentPriceDistribution([
      { bucketIndex: 0, count: 1 },
      { bucketIndex: 1, count: 3 },
    ]);
    expect(view.buckets[0]?.share).toBeCloseTo(0.25, 5);
    expect(view.buckets[1]?.share).toBeCloseTo(0.75, 5);
  });

  it("uses progressive Greenwood-family fills for higher buckets", () => {
    const view = presentPriceDistribution([]);
    // Lower-price buckets use ink (gray); high-price buckets use
    // greenwood-900 (almost black-green). Just sanity-check that the
    // light-to-dark progression is preserved.
    expect(view.buckets[0]?.fill).toBe("var(--ink-300)");
    expect(view.buckets[9]?.fill).toBe("var(--greenwood-900)");
  });
});
