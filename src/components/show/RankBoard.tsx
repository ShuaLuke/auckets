// "The room right now" RankBoard for the Show detail right column.
// Prototype-fidelity port of the RankBoard in
// design/ui_kits/auckets/screens/Show.jsx (lines 291-308).
//
// 3-up grid of stat cells: Your rank · Median offer · Capacity.
// Server-rendered — all values are pre-computed by presentRankBoard.

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { RankBoardView } from "@/lib/presenters";

type Props = {
  view: RankBoardView;
};

type StatProps = {
  label: string;
  value: string;
  sub: string;
};

function Stat({ label, value, sub }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-sans text-[11px] uppercase tracking-[0.1em]"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </span>
      <span
        className="font-mono tabular-nums"
        style={{
          fontSize: 22,
          letterSpacing: "-0.01em",
          color: "var(--fg)",
        }}
      >
        {value}
      </span>
      <span
        className="font-sans"
        style={{ fontSize: 12, color: "var(--ink-500)" }}
      >
        {sub}
      </span>
    </div>
  );
}

export function RankBoard({ view }: Props) {
  return (
    <Card className="p-5">
      <Eyebrow className="mb-3">The room right now</Eyebrow>
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Your rank"
          value={view.yourRankLabel}
          sub={view.yourRankSub}
        />
        <Stat
          label="Median offer"
          value={view.medianOfferLabel}
          sub={view.medianOfferSub}
        />
        <Stat
          label="Capacity"
          value={view.capacityLabel}
          sub={view.capacitySub}
        />
      </div>
    </Card>
  );
}
