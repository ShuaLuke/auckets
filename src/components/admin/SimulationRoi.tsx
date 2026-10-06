// The old way next to ours — the panel a venue reads first. One headline
// sentence, a short table with the differences signed and coloured by
// whether they went the right way, the per-tier split, and the one
// assumption stated out loud (the demand).

import { usd } from "@/lib/sim/format";
import { formatRoi, policyDisplayName, type RoiSummary } from "@/lib/sim/roi";

const n = (v: number): string => v.toLocaleString("en-US");
const pretty = (s: string): string => s.replace(/_/g, " ");

export function SimulationRoi({ roi }: { roi: RoiSummary }) {
  const th = "pb-1.5 text-left font-sans text-[10px] font-semibold uppercase tracking-wide";
  const td = "py-1.5 font-mono text-[12px]";
  return (
    <div>
      <p className="mb-4 font-sans text-[14px] leading-relaxed" style={{ color: "var(--fg)" }}>
        {roi.headline}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr style={{ color: "var(--fg-subtle)", borderBottom: "1px solid var(--border)" }}>
            <th className={th}></th>
            <th className={`${th} text-right`}>The old way</th>
            <th className={`${th} text-right`}>Auckets · {policyDisplayName(roi.ourPolicy)}</th>
            <th className={`${th} text-right`}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {roi.lines.map((l) => {
            const good = l.diff === 0 ? null : (l.diff > 0) === (l.betterWhen === "higher");
            return (
              <tr key={l.key} style={{ borderBottom: "1px solid var(--border)" }}>
                <td className="py-1.5 pr-3 font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
                  {l.label}
                </td>
                <td className={`${td} text-right`} style={{ color: "var(--fg-muted)" }}>
                  {formatRoi(l.old, l.kind)}
                </td>
                <td className={`${td} text-right`} style={{ color: "var(--fg)" }}>
                  {formatRoi(l.ours, l.kind)}
                </td>
                <td className={`${td} text-right font-semibold`} style={{ color: good === null ? "var(--fg-faint)" : good ? "var(--greenwood-700, #2f5d3a)" : "#8a1f1f" }}>
                  {formatRoi(l.diff, l.kind, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-4 font-sans text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>
        By tier
      </div>
      <table className="mt-1.5 w-full border-collapse">
        <thead>
          <tr style={{ color: "var(--fg-subtle)", borderBottom: "1px solid var(--border)" }}>
            <th className={th}>Tier</th>
            <th className={`${th} text-right`}>Old way</th>
            <th className={`${th} text-right`}>Auckets</th>
            <th className={`${th} text-right`}>Filled (old → ours)</th>
          </tr>
        </thead>
        <tbody>
          {roi.byTier.map((t) => (
            <tr key={t.tier} style={{ borderBottom: "1px solid var(--border)" }}>
              <td className="py-1.5 pr-3 font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
                {pretty(t.tier)}
              </td>
              <td className={`${td} text-right`} style={{ color: "var(--fg-muted)" }}>
                {usd(t.oldGrossCents)}
              </td>
              <td className={`${td} text-right`} style={{ color: "var(--fg)" }}>
                {usd(t.ourGrossCents)}
              </td>
              <td className={`${td} text-right`} style={{ color: "var(--fg-muted)" }}>
                {n(t.oldFilled)} → {n(t.ourFilled)} of {n(t.onSale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4 font-sans text-[12px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
        Same venue, same fans, same offers. The old way sells each tier at its face price to whoever arrives first; Auckets seats the same fans by what they offered. The only thing that changed is the allocation. The one assumption to check is the demand: these offers are what this crowd said it would pay — set the face prices to what the venue would really charge and run it again.
      </p>
    </div>
  );
}
