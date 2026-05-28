// Top-of-page snapshot row on the Artist Dashboard. Prototype-fidelity
// port of the SnapshotStat grid in design/ui_kits/auckets/screens/
// ArtistDashboard.jsx (lines 49-55, 68-88).
//
// Cell mapping vs. prototype (4 cells either way):
//   prototype                | this UI
//   ------------------------ | --------------------------
//   Offers in pool           | Offers in pool
//   Provisional payout       | Tickets in pool (subs — payout pending
//                            | Stripe Connect Express fee confirmation)
//   Median offer             | Median offer
//   Capacity filled          | Capacity filled (brand tone, restored
//                            | 2026-05-27)
//
// Provisional payout stays substituted with Tickets in pool until the
// Stripe Connect Express fee model is locked in (separate from the
// ADR-0003 working assumption — the assumption settled the auth path,
// not the per-charge fee rate). When that lands, the cell swaps in
// place; Tickets in pool either retires or moves into the per-show row
// stats below.

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
        label="Capacity filled"
        value={stats.capacityFilled}
        sub={stats.capacityFilledSub}
        tone="brand"
      />
    </div>
  );
}
