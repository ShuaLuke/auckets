// Recent activity feed on the ShowAdmin Overview tab. Mirrors
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 113-137 — a list
// of timestamped event rows ("2m ago · New offer · $54 × 2 · ...").
//
// Data shape is exactly ActivityEvent[] from the presenter; this
// component is pure display.

import { type ActivityEvent } from "@/lib/presenters";

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  events: readonly ActivityEvent[];
};

export function RecentActivityCard({ events }: Props) {
  return (
    <Card className="p-5">
      <Eyebrow className="mb-[14px]">Recent activity</Eyebrow>
      {events.length === 0 ? (
        <p
          className="font-sans text-sm"
          style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
        >
          No activity yet. New offers and revisions land here as they
          come in.
        </p>
      ) : (
        <div className="flex flex-col">
          {events.map((ev, i) => (
            <div
              key={`${ev.kind}-${ev.at.toISOString()}-${ev.offerTag}-${i}`}
              className="flex gap-[14px] py-2.5"
              style={{
                borderBottom:
                  i < events.length - 1
                    ? "1px solid var(--border-faint)"
                    : "none",
              }}
            >
              <span
                className="flex-shrink-0 pt-[2px] font-mono text-[11px] tabular-nums"
                style={{ minWidth: 56, color: "var(--fg-muted)" }}
              >
                {ev.timeAgo}
              </span>
              <span
                className="font-mono text-[12px]"
                style={{ color: "var(--ink-700)", lineHeight: 1.45 }}
              >
                {ev.message}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
