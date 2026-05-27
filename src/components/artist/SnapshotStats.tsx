// Top-of-page snapshot row on the Artist Dashboard. Prototype-fidelity
// port of the SnapshotStat grid in design/ui_kits/auckets/screens/
// ArtistDashboard.jsx (lines 49-55, 68-88).
//
// Cell mapping vs. prototype (4 cells either way):
//   prototype                | this UI
//   ------------------------ | --------------------------
//   Offers in pool           | Offers in pool
//   Provisional payout       | Tickets in pool (replaces — payout deferred)
//   Median offer             | Median offer
//   Capacity filled          | Top offer (replaces — capacity-filled deferred)
//
// "Provisional payout" + "Capacity filled" need cross-show seat-and-
// capacity aggregation lib/presenters/artist-shows.ts deliberately
// hasn't shipped yet (documented in that file's header comment).
// "Tickets in pool" and "Top offer" are presenter-derivable from data
// the API exposes today, so they're the least-wrong substitutes
// until the deferred two land.

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
  const ticketsWord = stats.ticketsInPool === 1 ? "ticket" : "tickets";
  return (
    <div className="grid grid-cols-4 gap-3">
      <Cell
        label="Offers in pool"
        value={String(stats.offersInPool)}
        sub={`across ${showCount} ${showWord}`}
      />
      <Cell
        label="Tickets in pool"
        value={String(stats.ticketsInPool)}
        sub={`total ${ticketsWord} requested`}
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
