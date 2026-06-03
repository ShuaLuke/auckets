// One row on the admin command-center shows list (`/admin`). Cross-artist
// sibling of ArtistShowRow: same date stub + capacity bar + stat columns,
// but it leads with the artist name (the admin list spans every artist)
// and accepts every show status, not just open ones.
//
// The row links to the existing artist ShowAdmin page
// (/artists/[artistId]/shows/[showId]) — an AUCKETS_ADMIN passes
// userCanManageArtist, so no separate admin detail page is needed for the
// first slice. A dedicated admin drill-down can replace the href later.

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  type AdminShowOpsView,
  type ArtistShowSummaryView,
} from "@/lib/presenters";

type Props = {
  artistId: string;
  show: ArtistShowSummaryView;
  // The state + next-move line and (post-binding) reconciliation read. The
  // guarded mutating controls themselves live one click away on ShowAdmin —
  // we surface the state here and link through, not duplicate the BIND button.
  ops: AdminShowOpsView;
};

// Open + window actually open → "open" tone; everything else (draft,
// paused, closed, allocating, allocated, complete, or open-but-not-yet)
// reads as "upcoming". Mirrors ArtistShowRow's two-state logic.
function badgeToneFor(show: ArtistShowSummaryView): BadgeTone {
  if (show.status === "open" && show.statusLabel === "Offers open") return "open";
  return "upcoming";
}

// "May 25" → { month: "MAY", day: "25" }.
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

export function AdminShowRow({ artistId, show, ops }: Props) {
  const stub = splitDateShort(show.dateShort);
  const tone = badgeToneFor(show);
  const pct =
    show.capacity > 0
      ? Math.round((show.provisionalFilled / show.capacity) * 100)
      : 0;

  return (
    <Link
      href={`/artists/${artistId}/shows/${show.id}`}
      className="flex items-center gap-5 rounded-xl border px-5 py-[18px] no-underline transition-shadow hover:shadow-[0_4px_12px_rgba(14,15,12,0.06)]"
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

      {/* Middle column — artist + venue/city/date + capacity bar */}
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg">{show.artist}</h3>
          <span
            className="font-sans text-xs"
            style={{ color: "var(--fg-subtle)" }}
          >
            {show.venue}
            {show.city ? ` · ${show.city}` : ""} · {show.dateLong}
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
        {/* Ops line — the state + next move. */}
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--fg-subtle)" }}
        >
          {ops.opsLine}
        </span>
      </div>

      {/* Stat columns */}
      <div className="grid grid-cols-3 gap-6">
        <Stat label="Tickets" value={show.ticketsCount} />
        <Stat label="Median" value={show.medianPrice} />
        <Stat label="Top" value={show.topPrice} accent />
      </div>

      {/* Status + reconciliation (post-binding) or countdown (pre-binding) */}
      <div className="flex flex-col items-end gap-1.5">
        <Badge tone={tone}>{show.statusLabel}</Badge>
        {ops.reconciliation ? (
          <span
            title={`${ops.reconciliation.chargedDisplay} · ${ops.reconciliation.detail}`}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-sans text-[11px]"
            style={
              ops.reconciliation.reconciled
                ? { background: "var(--greenwood-50)", color: "var(--greenwood-700)" }
                : { background: "var(--brick-100)", color: "var(--brick-700)" }
            }
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: ops.reconciliation.reconciled
                  ? "var(--greenwood-600)"
                  : "var(--brick-500)",
              }}
              aria-hidden
            />
            {ops.reconciliation.reconciled
              ? ops.reconciliation.chargedDisplay
              : ops.reconciliation.label}
          </span>
        ) : (
          show.closes && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--fg-subtle)" }}
            >
              {show.closes}
            </span>
          )
        )}
      </div>

      <ChevronRight
        size={18}
        strokeWidth={1.75}
        style={{ color: "var(--fg-faint)" }}
        aria-hidden
      />
    </Link>
  );
}
