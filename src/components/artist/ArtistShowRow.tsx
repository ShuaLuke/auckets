// One row on the Artist Dashboard. Renders a single show from the
// API's ArtistShowSummaryView. Prototype-fidelity port of the
// ArtistShowRow in design/ui_kits/auckets/screens/ArtistDashboard.jsx
// (lines 90-150).
//
// Differences from the prototype (each tracked in the PR description):
//   - "Payout" column is replaced by "Top". The prototype's payout is a
//     projection (≈ provisionalFilled × medianCents) that the API
//     doesn't compute. Top is a real per-show stat the API gives us;
//     swapping in here keeps three columns without inventing math.
//   - No onClick / button wrapper today. Artist show detail page lands
//     in a later slice; until then the row is informational.

import { type ArtistShowSummaryView } from "@/lib/presenters";

import { Badge, type BadgeTone } from "@/components/ui/Badge";

type Props = {
  show: ArtistShowSummaryView;
};

// Same tone logic as the fan-side ShowRow without the 'placed' branch —
// an artist viewing their own show doesn't have a personal offer on it.
function badgeToneFor(show: ArtistShowSummaryView): BadgeTone {
  if (show.status === "open" && show.statusLabel === "Offers open") return "open";
  return "upcoming";
}

// "Sat · May 25 · 8pm" → { month: "MAY", day: "25" }.
// dateShort from presentShowSummary is "May 25" — first two tokens.
function splitDateShort(dateShort: string): { month: string; day: string } {
  const [month = "", day = ""] = dateShort.split(" ");
  return { month: month.toUpperCase(), day };
}

type StatProps = {
  label: string;
  value: string | number;
  accent?: boolean;
};

function Stat({ label, value, accent = false }: StatProps) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className="font-sans text-[10px] uppercase tracking-[0.1em]"
        style={{ color: "var(--fg-muted)" }}
      >
        {label}
      </span>
      <span
        className="font-mono text-sm tabular-nums"
        style={{
          color: accent ? "var(--brand)" : "var(--fg)",
          fontWeight: accent ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export function ArtistShowRow({ show }: Props) {
  const stub = splitDateShort(show.dateShort);
  const tone = badgeToneFor(show);
  // Show 0 / 0 venues render 0% (no NaN) — empty pool, unstaged venue.
  const pct =
    show.capacity > 0
      ? Math.round((show.provisionalFilled / show.capacity) * 100)
      : 0;

  return (
    <div
      className="flex items-center gap-5 rounded-xl border px-5 py-[18px]"
      style={{ background: "var(--page)", borderColor: "var(--border)" }}
    >
      {/* Date stub */}
      <div
        className="flex-shrink-0 rounded-md py-2.5 text-center"
        style={{ width: 64, background: "var(--paper)" }}
      >
        <div
          className="font-mono text-[11px]"
          style={{ color: "var(--fg-muted)" }}
        >
          {stub.month}
        </div>
        <div className="mt-0.5 font-display text-[22px] font-bold leading-none">
          {stub.day}
        </div>
      </div>

      {/* Middle column — venue + city/dateLong + capacity bar */}
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg">{show.venue}</h3>
          <span
            className="font-sans text-xs"
            style={{ color: "var(--fg-subtle)" }}
          >
            {show.city ? `${show.city} · ` : ""}
            {show.dateLong}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-sm"
            style={{ background: "var(--paper)", maxWidth: 320 }}
          >
            <div
              className="h-full"
              style={{ width: `${pct}%`, background: "var(--brand)" }}
            />
          </div>
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {show.provisionalFilled} / {show.capacity} · {pct}%
          </span>
        </div>
      </div>

      {/* Stat columns */}
      <div className="grid grid-cols-3 gap-6">
        <Stat label="Offers" value={show.offers} />
        <Stat label="Median" value={show.medianPrice} />
        <Stat label="Top" value={show.topPrice} accent />
      </div>

      {/* Status + countdown */}
      <div className="flex flex-col items-end gap-1.5">
        <Badge tone={tone}>{show.statusLabel}</Badge>
        {show.closes && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--fg-subtle)" }}
          >
            {show.closes}
          </span>
        )}
      </div>
    </div>
  );
}
