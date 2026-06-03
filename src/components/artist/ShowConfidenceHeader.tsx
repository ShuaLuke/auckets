// ShowConfidenceHeader — Change 05.2. Opens the artist page to confidence on
// their real, live next show: how full it's getting, the demand it's drawing,
// and what the offers would gross vs the same seats at face (flat) pricing —
// the value-capture pitch ("the upside stays with you, not a reseller").
//
// Server component. Artist register: confident, not greedy. Aggregates only —
// never an individual fan's offer. Tokens only; mono for every number.

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Eyebrow } from "@/components/ui/Eyebrow";
import type { ShowConfidenceView } from "@/lib/presenters";

type Props = {
  artistId: string;
  view: ShowConfidenceView;
};

export function ShowConfidenceHeader({ artistId, view }: Props) {
  return (
    <Link
      href={`/artists/${artistId}/shows/${view.showId}`}
      className="block rounded-xl border no-underline transition-shadow hover:shadow-[0_4px_12px_rgba(14,15,12,0.06)]"
      style={{ background: "var(--page)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-col gap-6 p-6 md:p-7">
        {/* Header line */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <Eyebrow className="mb-2">Your next show</Eyebrow>
            <h2 className="font-display text-2xl leading-tight">{view.venue}</h2>
            <p
              className="mt-1 font-sans text-sm"
              style={{ color: "var(--fg-subtle)" }}
            >
              {view.city ? `${view.city} · ` : ""}
              {view.dateLong}
              {view.closes ? ` · ${view.closes}` : ""}
            </p>
          </div>
          <span
            className="font-sans text-[11px] uppercase tracking-[0.12em]"
            style={{ color: "var(--fg-muted)" }}
          >
            {view.statusLabel}
          </span>
        </div>

        {/* Fill */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="font-sans text-sm" style={{ color: "var(--fg-muted)" }}>
              Seats spoken for
            </span>
            <span
              className="font-mono text-sm tabular-nums"
              style={{ color: "var(--fg)" }}
            >
              {view.filled.toLocaleString("en-US")} /{" "}
              {view.capacity.toLocaleString("en-US")} · {view.fillPct}%
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-sm"
            style={{ background: "var(--paper)" }}
          >
            <div
              className="h-full"
              style={{ width: `${view.fillPct}%`, background: "var(--brand)" }}
            />
          </div>
        </div>

        {/* Demand + value-capture */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel>
            <PanelLabel>Demand</PanelLabel>
            <div
              className="font-mono text-lg tabular-nums"
              style={{ color: "var(--fg)" }}
            >
              {view.offers.toLocaleString("en-US")}{" "}
              <span className="text-sm" style={{ color: "var(--fg-muted)" }}>
                {view.offers === 1 ? "offer" : "offers"}
              </span>
            </div>
            <div
              className="mt-1 font-sans text-xs"
              style={{ color: "var(--fg-subtle)" }}
            >
              median <span className="font-mono">{view.medianPrice}</span> · top{" "}
              <span className="font-mono">{view.topPrice}</span> ·{" "}
              {view.ticketsCount.toLocaleString("en-US")} tickets requested
            </div>
          </Panel>

          {view.projection ? (
            <Panel tone="brand">
              <PanelLabel tone="brand">If offers seat now</PanelLabel>
              <div
                className="font-mono text-lg tabular-nums"
                style={{ color: "var(--paper)" }}
              >
                ≈ {view.projection.projectedGross}
              </div>
              <div
                className="mt-1 flex items-center gap-1.5 font-sans text-xs"
                style={{ color: "color-mix(in srgb, var(--paper) 82%, transparent)" }}
              >
                <ArrowUpRight size={13} aria-hidden />
                <span className="font-mono">
                  {view.projection.liftAmount}
                </span>{" "}
                vs <span className="font-mono">{view.projection.faceValue}</span>{" "}
                at face ({view.projection.liftPct >= 0 ? "+" : ""}
                {view.projection.liftPct}%)
              </div>
              <div
                className="mt-2 font-sans text-[11px]"
                style={{ color: "color-mix(in srgb, var(--paper) 64%, transparent)" }}
              >
                The upside stays with you, not a reseller.
              </div>
            </Panel>
          ) : (
            <Panel>
              <PanelLabel>If offers seat now</PanelLabel>
              <div
                className="font-sans text-sm"
                style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}
              >
                {view.projectionNote ??
                  "Your projected gross appears once offers come in."}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </Link>
  );
}

function Panel({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand";
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={
        tone === "brand"
          ? { background: "var(--brand)" }
          : { background: "var(--paper)", border: "1px solid var(--border)" }
      }
    >
      {children}
    </div>
  );
}

function PanelLabel({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand";
}) {
  return (
    <div
      className="mb-1.5 font-sans text-[10px] uppercase tracking-[0.12em]"
      style={{
        color:
          tone === "brand"
            ? "color-mix(in srgb, var(--paper) 70%, transparent)"
            : "var(--fg-subtle)",
      }}
    >
      {children}
    </div>
  );
}
