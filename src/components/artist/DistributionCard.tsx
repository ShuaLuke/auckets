// Offer-price distribution histogram on ShowAdmin. Ports
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 184-225.
// Bar height scales to the tallest bucket; share-of-pool count
// renders above each bar; price-range label below.

import { type PriceDistributionView } from "@/lib/presenters";

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  distribution: PriceDistributionView;
};

export function DistributionCard({ distribution }: Props) {
  const { buckets, total, maxCount } = distribution;
  return (
    <Card className="p-6">
      <div className="mb-[18px] flex items-baseline justify-between">
        <Eyebrow>Offer distribution · price per ticket</Eyebrow>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: "var(--fg-muted)" }}
        >
          n={total}
        </span>
      </div>

      {total === 0 ? (
        <p
          className="rounded-lg p-4 font-sans text-sm"
          style={{
            background: "var(--paper)",
            color: "var(--fg-muted)",
            lineHeight: 1.55,
          }}
        >
          No offers in the pool yet.
        </p>
      ) : (
        <>
          <div
            className="flex items-end gap-1.5 px-1 pb-6"
            style={{
              height: 180,
              borderBottom: "1px solid var(--border)",
            }}
          >
            {buckets.map((b) => {
              const barHeight = maxCount > 0 ? (b.count / maxCount) * 140 : 0;
              return (
                <div
                  key={b.label}
                  className="flex flex-1 flex-col items-center gap-1.5"
                >
                  <span
                    className="font-mono text-[11px] tabular-nums"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {b.count}
                  </span>
                  <div
                    className="w-full"
                    style={{
                      height: `${barHeight}px`,
                      background: b.fill,
                      borderRadius: "2px 2px 0 0",
                      transition: "height 200ms ease-out",
                    }}
                    aria-label={`${b.count} offers in ${b.label}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 px-1 pt-2">
            {buckets.map((b) => (
              <span
                key={b.label}
                className="flex-1 text-center font-mono text-[10px]"
                style={{ color: "var(--fg-muted)" }}
              >
                {b.label}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
