// "Offer pool — aggregate" card on the ShowAdmin page. Prototype-
// fidelity port of design/ui_kits/auckets/screens/ShowAdmin.jsx
// lines 100-112 (the BigStat 2×3 grid).
//
// Cells map vs. prototype (6 in prototype, 5 here):
//   prototype                 | this UI
//   ------------------------- | --------------------------
//   Offers                    | Offers
//   Provisional fill          | Provisional fill
//   Median price              | Median price
//   Top price                 | Top price
//   Provisional payout        | (deferred — needs Stripe fee math)
//   Unplaced                  | (deferred — needs a preview run to mean
//                              | anything; without it everyone is
//                              | "unplaced" relative to the seat map)
//   —                         | Tickets (added — sum of group_size)

import { type ArtistShowSummaryView } from "@/lib/presenters";

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  show: ArtistShowSummaryView;
};

type CellProps = {
  label: string;
  value: string | number;
  sub: string;
  accent?: boolean;
};

function BigStat({ label, value, sub, accent = false }: CellProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-sans text-[11px] uppercase tracking-[0.1em]"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-[22px] tabular-nums"
        style={{
          letterSpacing: "-0.01em",
          color: accent ? "var(--brand)" : "var(--fg)",
          fontWeight: accent ? 600 : 400,
        }}
      >
        {value}
      </span>
      <span
        className="font-sans text-xs"
        style={{ color: "var(--fg-muted)" }}
      >
        {sub}
      </span>
    </div>
  );
}

export function BigStatsCard({ show }: Props) {
  // Same NaN-safe computation as ArtistShowRow's capacity bar.
  const fillPct =
    show.capacity > 0
      ? Math.round((show.provisionalFilled / show.capacity) * 100)
      : 0;
  return (
    <Card className="p-5">
      <Eyebrow className="mb-[14px]">Offer pool — aggregate</Eyebrow>
      <div className="grid grid-cols-3 gap-[14px]">
        <BigStat
          label="Offers"
          value={show.offers}
          sub="in pool"
        />
        <BigStat
          label="Tickets"
          value={show.ticketsCount}
          sub="seats demanded"
        />
        <BigStat
          label="Provisional fill"
          value={`${fillPct}%`}
          sub={`${show.provisionalFilled} / ${show.capacity}`}
        />
        <BigStat
          label="Median price"
          value={show.medianPrice}
          sub="across the pool"
        />
        <BigStat
          label="Top price"
          value={show.topPrice}
          sub="single highest"
          accent
        />
      </div>
    </Card>
  );
}
