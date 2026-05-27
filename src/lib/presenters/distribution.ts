// Presenter for the ShowAdmin distribution histogram. Takes the
// repo's bucket aggregates (bucketIndex + count) and returns a
// view with labels, share-of-pool %, and the bar color shade
// matching the prototype mock (design/ui_kits/auckets/screens/
// ShowAdmin.jsx lines 184-225). Fixed buckets — matches the design
// snapshot directly, and works regardless of how concentrated the
// real pool turns out to be.

import type { PriceDistributionBucket } from "@/lib/db/repositories";

// Bucket layout: indexes correspond to the SQL CASE in
// getPriceDistributionForShow.
type BucketTemplate = {
  index: number;
  label: string;
  // Greenwood-progression — lighter buckets are cheaper, darker buckets
  // are pricier. Mirrors the prototype's `fill` colors literally.
  fill: string;
};

const BUCKETS: ReadonlyArray<BucketTemplate> = [
  { index: 0, label: "<$15", fill: "var(--ink-300)" },
  { index: 1, label: "$15-20", fill: "var(--ink-300)" },
  { index: 2, label: "$20-25", fill: "var(--greenwood-300)" },
  { index: 3, label: "$25-30", fill: "var(--greenwood-300)" },
  { index: 4, label: "$30-35", fill: "var(--greenwood-500)" },
  { index: 5, label: "$35-40", fill: "var(--greenwood-500)" },
  { index: 6, label: "$40-50", fill: "var(--greenwood-600)" },
  { index: 7, label: "$50-75", fill: "var(--greenwood-600)" },
  { index: 8, label: "$75-100", fill: "var(--greenwood-900)" },
  { index: 9, label: "$100+", fill: "var(--greenwood-900)" },
];

export type DistributionBucketView = {
  label: string;
  count: number;
  share: number; // 0-1
  fill: string;
};

export type PriceDistributionView = {
  buckets: readonly DistributionBucketView[];
  total: number;
  // The max count across buckets — useful for sizing the tallest bar
  // and scaling the rest. 0 when the pool is empty (no division by
  // zero in the renderer).
  maxCount: number;
};

export function presentPriceDistribution(
  rows: readonly PriceDistributionBucket[],
): PriceDistributionView {
  const byIndex = new Map<number, number>();
  let total = 0;
  for (const row of rows) {
    byIndex.set(row.bucketIndex, row.count);
    total += row.count;
  }
  let maxCount = 0;
  const buckets: DistributionBucketView[] = BUCKETS.map((t) => {
    const count = byIndex.get(t.index) ?? 0;
    if (count > maxCount) maxCount = count;
    return {
      label: t.label,
      count,
      share: total > 0 ? count / total : 0,
      fill: t.fill,
    };
  });
  return { buckets, total, maxCount };
}
