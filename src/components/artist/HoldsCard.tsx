// Holds — by source card on ShowAdmin. Ports
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 271-303 — one row
// per hold with a source tag, seat description, count, and an edit
// affordance gated by hold.kind.
//
// Mutability rules:
//   - artist-kind holds: deletable by any caller who can manage the
//     artist (member or admin). Visible trash icon.
//   - venue-kind holds: deletable only by AUCKETS_ADMIN. The page
//     passes viewerIsAdmin so admins see the trash icon on these
//     rows too; non-admins see the "Read-only" chip.
//
// Add hold flow (artist-kind only via the dialog) lives in
// AddHoldButton — admins create venue-kind via SQL until VENUE_STAFF
// lands.

import { type HoldsView } from "@/lib/presenters";

import { AddHoldButton, type AddHoldRow } from "@/components/artist/AddHoldButton";
import { DeleteHoldButton } from "@/components/artist/DeleteHoldButton";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  holds: HoldsView;
  // Show context the Add-hold dialog needs. The page projects
  // architecture rows + activeRowIds into the slim AddHoldRow shape
  // here so the client doesn't see the full jsonb.
  showId: string;
  activeRows: readonly AddHoldRow[];
};

function SourceTag({
  label,
  artist,
}: {
  label: string;
  artist: boolean;
}) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md px-2 py-1 font-sans text-[11px] font-semibold"
      style={{
        minWidth: 76,
        background: artist ? "var(--brand-bg)" : "var(--paper)",
        color: artist ? "var(--greenwood-700)" : "var(--fg-muted)",
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </span>
  );
}

export function HoldsCard({ holds, showId, activeRows }: Props) {
  const { rows, total } = holds;
  return (
    <Card className="p-6">
      <div className="mb-3.5 flex items-baseline justify-between gap-3">
        <Eyebrow>Holds — by source</Eyebrow>
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {total} {total === 1 ? "seat" : "seats"} held
          </span>
          <AddHoldButton showId={showId} rows={activeRows} />
        </div>
      </div>

      {rows.length === 0 ? (
        <p
          className="rounded-lg p-4 font-sans text-sm"
          style={{
            background: "var(--paper)",
            color: "var(--fg-muted)",
            lineHeight: 1.55,
          }}
        >
          No holds on this show. ADA, venue, and artist comp holds appear
          here once they&apos;re filed.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-4 rounded-lg px-[14px] py-3"
              style={{ background: "var(--paper)" }}
            >
              <SourceTag label={row.source} artist={row.kind === "artist"} />
              <span
                className="flex-1 font-mono text-[12px]"
                style={{ color: "var(--ink-700)" }}
              >
                {row.seatDescription}
              </span>
              <span
                className="font-mono text-[11px] tabular-nums"
                style={{ color: "var(--fg-muted)" }}
              >
                {row.seatCount} {row.seatCount === 1 ? "seat" : "seats"}
              </span>
              {row.mutable ? (
                <DeleteHoldButton
                  holdId={row.id}
                  description={row.seatDescription}
                />
              ) : (
                <span
                  className="font-sans text-[10px] uppercase tracking-[0.08em]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  Read-only
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
