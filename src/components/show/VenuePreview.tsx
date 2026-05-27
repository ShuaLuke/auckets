// VenuePreview seat map on the fan Show detail right column. Mirrors
// design/ui_kits/auckets/screens/Show.jsx VenuePreview (lines 220-289)
// but driven by real data — the GAE's provisional placement plus the
// fan's own assignment, not the design's synthetic % 3 texture.
//
// Layout: STAGE marker, hairline divider, then one block per tier in
// venue order (closest-to-stage first). Each row is a strip of seat
// blocks. Three seat states:
//   - yours    — solid Greenwood, the caller's seats
//   - placed   — soft Greenwood-100, someone else's assignment
//   - unfilled — dashed outline, no assignment
//
// Server component; the parent page is dynamic="force-dynamic" so the
// rendered state always reflects the latest seat_assignments at request
// time.

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { FanSeatStatus, VenuePreviewView } from "@/lib/presenters";

type Props = {
  view: VenuePreviewView;
  venueName: string;
};

function SeatBlock({ status }: { status: FanSeatStatus }) {
  const bg =
    status === "yours"
      ? "var(--brand)"
      : status === "placed"
        ? "var(--greenwood-100)"
        : "transparent";
  const border =
    status === "unfilled" ? "1px dashed var(--border-strong)" : "none";
  const label =
    status === "yours"
      ? "your seat"
      : status === "placed"
        ? "placed seat"
        : "unfilled seat";
  return (
    <div
      className="h-[14px] rounded-sm"
      style={{ flex: 1, background: bg, border }}
      aria-label={label}
    />
  );
}

export function VenuePreview({ view, venueName }: Props) {
  if (view.sections.length === 0) {
    return (
      <Card className="p-6">
        <Eyebrow className="mb-3">Venue · {venueName}</Eyebrow>
        <p
          className="font-sans"
          style={{ fontSize: 13, color: "var(--ink-500)", lineHeight: 1.55 }}
        >
          No active rows configured for this show yet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <Eyebrow>Venue · {venueName}</Eyebrow>
        {view.hasYourPlacement && (
          <span
            className="font-mono"
            style={{ fontSize: 11, color: "var(--fg-muted)" }}
          >
            your seats highlighted
          </span>
        )}
      </div>
      <div
        className="rounded-lg p-6"
        style={{ background: "var(--paper)" }}
      >
        <div
          className="mb-3 text-center font-mono text-[10px] uppercase tracking-[0.16em]"
          style={{ color: "var(--fg-muted)" }}
        >
          STAGE
        </div>
        <div
          className="mb-[22px] h-1 rounded-sm"
          style={{ background: "var(--ink-900)", margin: "0 64px 22px" }}
        />
        {view.sections.map((section) => (
          <div key={section.tier} className="mb-[18px]">
            <div
              className="mb-2 font-sans text-[10px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--fg-muted)" }}
            >
              {section.tier}
            </div>
            <div className="flex flex-col gap-1">
              {section.rows.map((row) => (
                <div
                  key={row.rowId}
                  className="flex items-center gap-1"
                >
                  <span
                    className="text-right font-mono text-[10px]"
                    style={{
                      width: 22,
                      color: row.isYourRow ? "var(--brand)" : "var(--fg-muted)",
                      fontWeight: row.isYourRow ? 600 : 400,
                    }}
                  >
                    {row.rowName}
                  </span>
                  <div className="flex flex-1 gap-[3px]">
                    {row.seats.map((seat) => (
                      <SeatBlock
                        key={`${row.rowId}-${seat.number}`}
                        status={seat.status}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
