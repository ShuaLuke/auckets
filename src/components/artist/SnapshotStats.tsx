// Top-of-page snapshot row on the Artist Dashboard. Prototype-fidelity
// port of the SnapshotStat grid in design/ui_kits/auckets/screens/
// ArtistDashboard.jsx (lines 49-55, 68-88).
//
// The prototype shows four cells: Offers in pool / Provisional payout /
// Median offer / Capacity filled. We render three — the two deferred
// stats (provisionalPayout, capacityFilled) need cross-show seat-and-
// capacity aggregation that lib/presenters/artist-shows.ts deliberately
// hasn't shipped yet. Documented in that file's header comment. The
// third cell here is Top offer, which the API exposes; the prototype
// doesn't slot it in but it's useful signal for the artist while the
// "real" two stats are still in flight.
//
// Brand-toned cell (the prototype's accent for "Capacity filled") is
// kept off until we have something worth highlighting in it.

import { type ArtistSnapshotStatsView } from "@/lib/presenters";

type Props = {
  stats: ArtistSnapshotStatsView;
  showCount: number;
};

type CellProps = {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "brand";
};

function Cell({ label, value, sub, tone = "default" }: CellProps) {
  const isBrand = tone === "brand";
  return (
    <div
      className="flex flex-col gap-1 rounded-xl border p-4"
      style={{
        background: isBrand ? "var(--ink-900)" : "var(--page)",
        color: isBrand ? "var(--paper)" : "var(--fg)",
        borderColor: "var(--border)",
      }}
    >
      <span
        className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: isBrand ? "var(--ink-300)" : "var(--fg-muted)" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[26px] tabular-nums"
        style={{
          letterSpacing: "-0.01em",
          color: isBrand ? "var(--paper)" : "var(--fg)",
        }}
      >
        {value}
      </span>
      <span
        className="font-sans text-xs"
        style={{ color: isBrand ? "var(--ink-200)" : "var(--fg-muted)" }}
      >
        {sub}
      </span>
    </div>
  );
}

export function SnapshotStats({ stats, showCount }: Props) {
  const showWord = showCount === 1 ? "show" : "shows";
  return (
    <div className="grid grid-cols-3 gap-3">
      <Cell
        label="Offers in pool"
        value={String(stats.offersInPool)}
        sub={`across ${showCount} ${showWord}`}
      />
      <Cell
        label="Median offer"
        value={stats.medianOffer}
        sub="across all open shows"
      />
      <Cell
        label="Top offer"
        value={stats.topOffer}
        sub="single highest offer"
      />
    </div>
  );
}
