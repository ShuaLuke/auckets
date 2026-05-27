// Provisional placement seat map on ShowAdmin. Ports
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 227-269 — STAGE
// label at the top, tier sections beneath, each tier showing its
// rows as horizontal grids of seat blocks. A placed seat is solid
// Greenwood; unfilled is a dashed outline.
//
// "Orphan" and "Hold" seat states from the prototype are intentionally
// not surfaced yet — see presenter notes in lib/presenters/placement.ts
// for their data-source requirements.

import { type ProvisionalPlacementView } from "@/lib/presenters";

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  placement: ProvisionalPlacementView;
};

function SeatBlock({ status }: { status: "placed" | "unfilled" }) {
  const placed = status === "placed";
  return (
    <div
      className="h-[11px] rounded-sm"
      style={{
        flex: 1,
        background: placed ? "var(--brand)" : "transparent",
        border: placed ? "none" : "1px dashed var(--border-strong)",
      }}
      aria-label={placed ? "placed seat" : "unfilled seat"}
    />
  );
}

export function ProvisionalPlacementCard({ placement }: Props) {
  const { sections, summary } = placement;
  const pct = Math.round(summary.fillRate * 100);
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <Eyebrow>Provisional placement — if allocation ran now</Eyebrow>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: "var(--fg-muted)" }}
        >
          {summary.placedSeats} placed · {summary.unfilledSeats} unfilled ·{" "}
          {pct}% full
        </span>
      </div>

      {summary.totalSeats === 0 ? (
        <p
          className="rounded-lg p-4 font-sans text-sm"
          style={{
            background: "var(--paper)",
            color: "var(--fg-muted)",
            lineHeight: 1.55,
          }}
        >
          No active rows configured for this show.
        </p>
      ) : (
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
            style={{ background: "var(--ink-900)", margin: "0 80px 22px" }}
          />
          {sections.map((section) => (
            <div key={section.tier} className="mb-4">
              <div
                className="mb-1.5 font-sans text-[10px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: "var(--fg-muted)" }}
              >
                {section.tier}
              </div>
              {section.rows.map((row) => (
                <div
                  key={row.rowId}
                  className="mb-[3px] flex items-center gap-1"
                >
                  <span
                    className="text-right font-mono text-[10px]"
                    style={{
                      width: 24,
                      color: "var(--fg-muted)",
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
          ))}
        </div>
      )}
    </Card>
  );
}
