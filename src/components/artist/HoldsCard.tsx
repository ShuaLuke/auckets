// Holds — by source card on ShowAdmin. Ports
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 271-303 — one row
// per hold with a source tag, seat description, count, and an edit
// affordance gated by hold.kind.
//
// Today: read-only view. The "Add hold" button + per-row trash icon
// + per-row edit are deferred to a write-path slice that ships with
// the hold form. Artist-mutable rows still show the visual treatment
// they'd have (trash icon position, source-tag color) — the icon is
// rendered but disabled with an aria-label, matching the prototype's
// "you can do this here" affordance without the actual mutation
// wired.

import { Trash2 } from "lucide-react";

import { type HoldsView } from "@/lib/presenters";

import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";

type Props = {
  holds: HoldsView;
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

export function HoldsCard({ holds }: Props) {
  const { rows, total } = holds;
  return (
    <Card className="p-6">
      <div className="mb-3.5 flex items-baseline justify-between">
        <Eyebrow>Holds — by source</Eyebrow>
        <span
          className="font-mono text-[11px] tabular-nums"
          style={{ color: "var(--fg-muted)" }}
        >
          {total} {total === 1 ? "seat" : "seats"} held
        </span>
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
              <SourceTag label={row.source} artist={row.mutable} />
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
                // Edit affordance is positioned but inert today —
                // mutation flow lands in a follow-up slice.
                <button
                  type="button"
                  disabled
                  aria-label="Remove hold (coming soon)"
                  title="Remove hold (coming soon)"
                  className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent"
                  style={{ color: "var(--fg-faint)", cursor: "not-allowed" }}
                >
                  <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                </button>
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
