// The Simulation tab. Describe a crowd for a library venue, run the real
// engine through POST /api/admin/simulation, read the fill report, keep the
// run, compare runs. Everything stays in this page's state — nothing is
// persisted, nothing touches a real show.

"use client";

import { useMemo, useState } from "react";

import { SimulationMarkdown } from "@/components/admin/SimulationMarkdown";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { TextInput } from "@/components/ui/TextInput";
import { compareRuns, renderComparison } from "@/lib/sim/compare";
import { usd } from "@/lib/sim/format";
import type { LibraryPoolSummary, LibraryVenueSummary } from "@/lib/sim/library";
import type { RunOutput } from "@/lib/sim/types";

type Props = {
  venues: LibraryVenueSummary[];
  pools: LibraryPoolSummary[];
  presets: Record<string, Record<string, number>>;
};

type SavedRun = {
  id: string;
  label: string;
  at: string;
  output: RunOutput;
  reportMd: string;
  offersCsv: Record<string, string>;
  seatmapTxt: Record<string, string>;
  elapsedMs: number;
};

const POLICIES: { key: string; label: string; hint: string }[] = [
  { key: "greedy", label: "Greedy (shipped)", hint: "Strict rank order. Rank-first." },
  { key: "clean-fit", label: "Clean-fit", hint: "Defers a fitting group that would strand seats. Widens rank-respect by those deferrals." },
  { key: "lookahead", label: "Lookahead (Cope's Phase 6)", hint: "Looks two rows ahead; defers at most one offer per row. Fill-first, not rank-first." },
  { key: "parity-tiebreak", label: "Parity tiebreak", hint: "Reorders only at equal price so odd groups meet odd remainders." },
  { key: "singles-reserve", label: "Singles reserve", hint: "Holds back the lowest-ranked singles for 1-seat rows. Not rank-first." },
  { key: "clean-fit+singles-reserve", label: "Clean-fit + singles reserve", hint: "The combination that filled the Lincoln to 99.8%." },
  { key: "protect-units", label: "Protect tables/boxes", hint: "One group per table or box (NEW-14). Only matters on venues with tables." },
];

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function download(filename: string, text: string, type = "text/plain"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function SimulationLab({ venues, pools, presets }: Props) {
  const [venue, setVenue] = useState(venues[0]?.name ?? "");
  const [poolKind, setPoolKind] = useState<"generate" | "library">("generate");
  const [poolName, setPoolName] = useState(pools[0]?.name ?? "");
  const [preset, setPreset] = useState<string>("custom");
  const [mix, setMix] = useState<Record<number, string>>({ 1: "10", 2: "45", 3: "10", 4: "25", 5: "5", 6: "5", 7: "0", 8: "0", 9: "0", 10: "0" });
  const [oversub, setOversub] = useState("1.25");
  const [seed, setSeed] = useState("1");
  const [seeds, setSeeds] = useState("5");
  const [policies, setPolicies] = useState<string[]>(["greedy", "clean-fit"]);
  const [activeSections, setActiveSections] = useState<string[]>([]);
  const [holdTier, setHoldTier] = useState("");
  const [holdSeats, setHoldSeats] = useState("0");
  const [maxGroup, setMaxGroup] = useState("10");
  const [autoBid, setAutoBid] = useState("0");
  const [raiseRule, setRaiseRule] = useState<"fixed" | "percent">("fixed");
  const [privateShare, setPrivateShare] = useState("0");
  const [seatPrefShare, setSeatPrefShare] = useState("0");
  const [bleacherPct, setBleacherPct] = useState("0");
  const [bleacherPrice, setBleacherPrice] = useState("40");
  const [timelineOn, setTimelineOn] = useState(false);
  const [windowDays, setWindowDays] = useState("6");
  const [arrival, setArrival] = useState<"uniform" | "front-loaded" | "last-day-spike" | "s-curve">("last-day-spike");
  const [previewEvery, setPreviewEvery] = useState("12");
  const [revisions, setRevisions] = useState("25");
  const [withdrawals, setWithdrawals] = useState("3");
  const [confirmHours, setConfirmHours] = useState("24");
  const [returns, setReturns] = useState("5");
  const [refill, setRefill] = useState<"release" | "keep-pool-live">("release");
  const [upgrades, setUpgrades] = useState("0");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [compareMd, setCompareMd] = useState<string | null>(null);

  const venueInfo = venues.find((v) => v.name === venue);
  const mixTotal = useMemo(() => SIZES.reduce((s, z) => s + (Number(mix[z]) || 0), 0), [mix]);
  const mixOk = Math.abs(mixTotal - 100) < 0.01;

  function applyPreset(name: string): void {
    setPreset(name);
    if (name === "custom") return;
    const p = presets[name];
    if (!p) return;
    const next: Record<number, string> = {};
    for (const z of SIZES) next[z] = String(p[String(z)] ?? 0);
    setMix(next);
  }

  function togglePolicy(key: string): void {
    setPolicies((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : cur.length >= 4 ? cur : [...cur, key]));
  }

  const previews = timelineOn ? Math.ceil((Number(windowDays) * 24) / Math.max(1, Number(previewEvery))) + 1 : 1;
  const allocations = (poolKind === "library" ? 1 : Number(seeds)) * policies.length * previews;

  async function run(): Promise<void> {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const groupSizeMix = preset !== "custom" ? preset : Object.fromEntries(SIZES.filter((z) => Number(mix[z]) > 0).map((z) => [String(z), Number(mix[z])]));
      const body = {
        venue,
        ...(activeSections.length > 0 && { activeSections }),
        ...(holdTier && Number(holdSeats) > 0 && { holds: [{ source: "artist", tier: holdTier, seats: Number(holdSeats) }] }),
        maxGroupSize: Number(maxGroup),
        pool:
          poolKind === "library"
            ? { kind: "library", name: poolName }
            : {
                kind: "generate",
                seed: Number(seed),
                oversubscription: Number(oversub),
                groupSizeMix,
                autoBidSharePct: Number(autoBid),
                privateSharePct: Number(privateShare),
                seatPrefSharePct: Number(seatPrefShare),
              },
        policies,
        seeds: Number(seeds),
        autoBidRaiseRule: raiseRule === "fixed" ? { kind: "fixed", cents: 500 } : { kind: "percent", pct: 5 },
        ...(Number(bleacherPct) > 0 && { bleacher: { sharePct: Number(bleacherPct), priceCents: Math.round(Number(bleacherPrice) * 100) } }),
        ...(timelineOn && {
          timeline: {
            windowDays: Number(windowDays),
            arrival,
            previewEveryHours: Number(previewEvery),
            revisionsSharePct: Number(revisions),
            withdrawalsSharePct: Number(withdrawals),
            rollingConfirmedHours: Number(confirmHours),
            returnsSharePct: Number(returns),
            refill,
            ...(Number(upgrades) > 0 && { upgrades: { requestSharePct: Number(upgrades), acceptRatePct: 40, premiumPct: 25 } }),
          },
        }),
      };
      const res = await fetch("/api/admin/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as Partial<{ ok: true; output: RunOutput; reportMd: string; offersCsv: Record<string, string>; seatmapTxt: Record<string, string>; elapsedMs: number; error: string; details: { path: (string | number)[]; message: string }[] }>;
      if (!res.ok || !json.ok || !json.output) {
        const detail = json.details?.map((d) => `${d.path.join(".")}: ${d.message}`).join("; ");
        setError(json.error ? `${json.error}${detail ? ` — ${detail}` : ""}` : `Failed (HTTP ${res.status})`);
        return;
      }
      const id = `run-${Date.now()}`;
      const label = `${venueInfo?.displayName.split(" —")[0] ?? venue} · ${poolKind === "library" ? poolName : `${preset === "custom" ? "custom mix" : preset} ×${oversub}`} · ${policies.join(", ")}${timelineOn ? ` · ${windowDays}d window` : ""}`;
      const saved: SavedRun = { id, label, at: new Date().toLocaleTimeString(), output: json.output, reportMd: json.reportMd ?? "", offersCsv: json.offersCsv ?? {}, seatmapTxt: json.seatmapTxt ?? {}, elapsedMs: json.elapsedMs ?? 0 };
      setRuns((cur) => [saved, ...cur].slice(0, 12));
      setCurrent(id);
      setCompareMd(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  function compareSelected(): void {
    const chosen = runs.filter((r) => selected.includes(r.id));
    if (chosen.length < 2) return;
    try {
      const c = compareRuns(chosen.map((r) => ({ runName: r.label, output: r.output })));
      setCompareMd(renderComparison(c));
      setCurrent(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not compare");
    }
  }

  const shown = runs.find((r) => r.id === current) ?? null;
  const headline = (r: SavedRun): string => {
    const a = r.output.aggregates[0];
    if (!a) return "";
    const fill = a.scalars["fill.fillRate"]?.p50 ?? 0;
    const gross = a.scalars["revenue.grossPlacedCents"]?.p50 ?? 0;
    return `${(100 * fill).toFixed(1)}% fill · ${usd(gross)} gross`;
  };

  const inputCls = "w-full";
  const sectionTitle = (t: string): JSX.Element => (
    <div className="mb-3 mt-6 font-sans text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-subtle)" }}>
      {t}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <Card className="p-5">
        <Eyebrow className="mb-3">Set up a run</Eyebrow>

        <Field label="Venue" htmlFor="sim-venue">
          <select id="sim-venue" className="w-full rounded-lg border px-3 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={venue} onChange={(e) => { setVenue(e.target.value); setActiveSections([]); setHoldTier(""); }}>
            {venues.map((v) => (
              <option key={v.name} value={v.name}>
                {v.displayName} — {v.capacity.toLocaleString()} seats
              </option>
            ))}
          </select>
        </Field>
        {venueInfo && (
          <div className="mt-1 font-sans text-xs" style={{ color: "var(--fg-faint)" }}>
            Tiers {venueInfo.tiers.join(" › ")} · {venueInfo.rows} rows · floors {Object.entries(venueInfo.floorsCents).map(([t, c]) => `${t} ${usd(c)}`).join(", ") || "none set"}
          </div>
        )}

        {sectionTitle("The crowd")}
        <div className="mb-3 flex gap-2">
          <Button size="sm" variant={poolKind === "generate" ? "primary" : "secondary"} onClick={() => setPoolKind("generate")}>
            Describe it
          </Button>
          <Button size="sm" variant={poolKind === "library" ? "primary" : "secondary"} onClick={() => setPoolKind("library")} disabled={pools.length === 0}>
            Use a real pool
          </Button>
        </div>
        {poolKind === "library" ? (
          <Field label="Offer pool">
            <select className="w-full rounded-lg border px-3 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={poolName} onChange={(e) => setPoolName(e.target.value)}>
              {pools.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName} — {p.offers} offers, {p.tickets} tickets
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="Group-size mix (% of offers)" hint={mixOk ? "Sums to 100." : `Sums to ${mixTotal.toFixed(1)} — must be 100.`}>
              <select className="mb-2 w-full rounded-lg border px-3 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={preset} onChange={(e) => applyPreset(e.target.value)}>
                <option value="custom">Custom</option>
                {Object.keys(presets).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-5 gap-1.5">
                {SIZES.map((z) => (
                  <label key={z} className="flex flex-col gap-0.5 font-sans text-[11px]" style={{ color: "var(--fg-faint)" }}>
                    {z}
                    <input className="rounded-md border px-1.5 py-1 font-mono text-xs" style={{ borderColor: mixOk ? "var(--border-strong)" : "var(--brand)", background: "var(--page)" }} inputMode="decimal" value={mix[z] ?? "0"} onChange={(e) => { setPreset("custom"); setMix((cur) => ({ ...cur, [z]: e.target.value })); }} />
                  </label>
                ))}
              </div>
            </Field>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Demand (tickets ÷ seats)" htmlFor="sim-oversub">
                <TextInput id="sim-oversub" className={inputCls} inputMode="decimal" value={oversub} onChange={(e) => setOversub(e.target.value)} suffix="×" mono />
              </Field>
              <Field label="Seeds (crowds to draw)" htmlFor="sim-seeds">
                <TextInput id="sim-seeds" className={inputCls} inputMode="numeric" value={seeds} onChange={(e) => setSeeds(e.target.value)} mono />
              </Field>
            </div>
          </>
        )}

        {sectionTitle("Policies (up to 4)")}
        <div className="flex flex-col gap-1.5">
          {POLICIES.map((p) => (
            <label key={p.key} className="flex cursor-pointer items-start gap-2 font-sans text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={policies.includes(p.key)} onChange={() => togglePolicy(p.key)} />
              <span>
                {p.label}
                <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                  {p.hint}
                </span>
              </span>
            </label>
          ))}
        </div>

        <button type="button" className="mt-5 font-sans text-xs underline" style={{ color: "var(--fg-muted)" }} onClick={() => setShowAdvanced((s) => !s)}>
          {showAdvanced ? "Hide" : "Show"} advanced: sections, holds, auto-bid, Bleacher, timeline
        </button>

        {showAdvanced && (
          <>
            {sectionTitle("This show")}
            {venueInfo && venueInfo.sections.length > 1 && (
              <Field label="Sections on sale (none = whole room)">
                <div className="flex flex-wrap gap-1">
                  {venueInfo.sections.map((s) => {
                    const on = activeSections.includes(s);
                    return (
                      <button key={s} type="button" className="rounded-full border px-2 py-0.5 font-sans text-[11px]" style={{ borderColor: on ? "var(--ink-900)" : "var(--border)", background: on ? "var(--ink-900)" : "transparent", color: on ? "var(--paper)" : "var(--fg-muted)" }} onClick={() => setActiveSections((cur) => (on ? cur.filter((x) => x !== s) : [...cur, s]))}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            <div className="mt-3 grid grid-cols-3 gap-3">
              <Field label="Artist holds: tier">
                <select className="w-full rounded-lg border px-2 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={holdTier} onChange={(e) => setHoldTier(e.target.value)}>
                  <option value="">none</option>
                  {venueInfo?.tiers.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hold seats" htmlFor="sim-holds">
                <TextInput id="sim-holds" inputMode="numeric" value={holdSeats} onChange={(e) => setHoldSeats(e.target.value)} mono />
              </Field>
              <Field label="Group cap" htmlFor="sim-cap">
                <TextInput id="sim-cap" inputMode="numeric" value={maxGroup} onChange={(e) => setMaxGroup(e.target.value)} mono />
              </Field>
            </div>

            {poolKind === "generate" && (
              <>
                {sectionTitle("Offer features")}
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Auto-bid %" htmlFor="sim-ab">
                    <TextInput id="sim-ab" inputMode="numeric" value={autoBid} onChange={(e) => setAutoBid(e.target.value)} mono />
                  </Field>
                  <Field label="Private offers %" htmlFor="sim-pv">
                    <TextInput id="sim-pv" inputMode="numeric" value={privateShare} onChange={(e) => setPrivateShare(e.target.value)} mono />
                  </Field>
                  <Field label="Seat prefs %" htmlFor="sim-sp">
                    <TextInput id="sim-sp" inputMode="numeric" value={seatPrefShare} onChange={(e) => setSeatPrefShare(e.target.value)} mono />
                  </Field>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Auto-bid step rule">
                    <select className="w-full rounded-lg border px-2 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={raiseRule} onChange={(e) => setRaiseRule(e.target.value as "fixed" | "percent")}>
                      <option value="fixed">Fixed $5 (shipped)</option>
                      <option value="percent">5% of price (Cope)</option>
                    </select>
                  </Field>
                  <Field label="Seed" htmlFor="sim-seed">
                    <TextInput id="sim-seed" inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value)} mono />
                  </Field>
                </div>
              </>
            )}

            {sectionTitle("Bleacher carve-out (unconfirmed)")}
            <div className="grid grid-cols-2 gap-3">
              <Field label="% of seats" htmlFor="sim-bl">
                <TextInput id="sim-bl" inputMode="decimal" value={bleacherPct} onChange={(e) => setBleacherPct(e.target.value)} mono />
              </Field>
              <Field label="Flat price" htmlFor="sim-blp">
                <TextInput id="sim-blp" inputMode="decimal" value={bleacherPrice} onChange={(e) => setBleacherPrice(e.target.value)} prefix="$" mono />
              </Field>
            </div>

            {sectionTitle("Timeline")}
            <label className="flex items-center gap-2 font-sans text-[13px]">
              <input type="checkbox" checked={timelineOn} onChange={(e) => setTimelineOn(e.target.checked)} />
              Play the offer window out in time (previews, displacement, returns)
            </label>
            {timelineOn && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Window (days)" htmlFor="sim-wd">
                  <TextInput id="sim-wd" inputMode="numeric" value={windowDays} onChange={(e) => setWindowDays(e.target.value)} mono />
                </Field>
                <Field label="Preview every (hours)" htmlFor="sim-pe">
                  <TextInput id="sim-pe" inputMode="numeric" value={previewEvery} onChange={(e) => setPreviewEvery(e.target.value)} mono />
                </Field>
                <Field label="Arrivals">
                  <select className="w-full rounded-lg border px-2 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={arrival} onChange={(e) => setArrival(e.target.value as typeof arrival)}>
                    <option value="uniform">uniform</option>
                    <option value="front-loaded">front-loaded</option>
                    <option value="last-day-spike">last-day spike</option>
                    <option value="s-curve">s-curve</option>
                  </select>
                </Field>
                <Field label="Confirmed after (hours)" htmlFor="sim-ch">
                  <TextInput id="sim-ch" inputMode="numeric" value={confirmHours} onChange={(e) => setConfirmHours(e.target.value)} mono />
                </Field>
                <Field label="Revisers %" htmlFor="sim-rv">
                  <TextInput id="sim-rv" inputMode="numeric" value={revisions} onChange={(e) => setRevisions(e.target.value)} mono />
                </Field>
                <Field label="Withdrawals %" htmlFor="sim-wd2">
                  <TextInput id="sim-wd2" inputMode="numeric" value={withdrawals} onChange={(e) => setWithdrawals(e.target.value)} mono />
                </Field>
                <Field label="Returns after binding %" htmlFor="sim-rt">
                  <TextInput id="sim-rt" inputMode="numeric" value={returns} onChange={(e) => setReturns(e.target.value)} mono />
                </Field>
                <Field label="Refill returned seats">
                  <select className="w-full rounded-lg border px-2 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={refill} onChange={(e) => setRefill(e.target.value as typeof refill)}>
                    <option value="release">release (today&apos;s rule)</option>
                    <option value="keep-pool-live">keep pool live (playbook)</option>
                  </select>
                </Field>
                <Field label="Upgrade requests %" htmlFor="sim-up" hint="Holders accept 40% at +25%">
                  <TextInput id="sim-up" inputMode="numeric" value={upgrades} onChange={(e) => setUpgrades(e.target.value)} mono />
                </Field>
              </div>
            )}
          </>
        )}

        <div className="mt-6 flex items-center gap-3">
          <Button onClick={run} disabled={running || policies.length === 0 || !venue || (poolKind === "generate" && !mixOk)}>
            {running ? "Running…" : "Run"}
          </Button>
          <span className="font-sans text-xs" style={{ color: "var(--fg-faint)" }}>
            {allocations.toLocaleString()} allocation{allocations === 1 ? "" : "s"}
            {allocations > 400 ? " — over the 400 limit" : ""}
          </span>
        </div>
        {error && (
          <div className="mt-3 rounded-lg px-3 py-2 font-sans text-[13px]" style={{ background: "rgba(180, 40, 40, 0.08)", color: "#8a1f1f" }}>
            {error}
          </div>
        )}
      </Card>

      <div className="min-w-0">
        {runs.length > 0 && (
          <Card className="mb-4 p-4">
            <div className="mb-2 flex items-center justify-between">
              <Eyebrow>Runs this session</Eyebrow>
              <Button size="sm" variant="secondary" onClick={compareSelected} disabled={selected.length < 2}>
                Compare selected ({selected.length})
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              {runs.map((r) => (
                <div key={r.id} className="flex items-center gap-2 font-sans text-[13px]">
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => setSelected((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id]))} />
                  <button type="button" className="truncate text-left underline-offset-2 hover:underline" style={{ color: current === r.id ? "var(--ink-900)" : "var(--fg-muted)", fontWeight: current === r.id ? 600 : 400 }} onClick={() => { setCurrent(r.id); setCompareMd(null); }}>
                    {r.label}
                  </button>
                  <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: "var(--fg-faint)" }}>
                    {headline(r)} · {r.at}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {compareMd && (
          <Card className="p-5">
            <SimulationMarkdown md={compareMd} />
            <div className="mt-4">
              <Button size="sm" variant="secondary" onClick={() => download("compare.md", compareMd, "text/markdown")}>
                Download compare.md
              </Button>
            </div>
          </Card>
        )}

        {shown && !compareMd && (
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => download("report.md", shown.reportMd, "text/markdown")}>
                report.md
              </Button>
              {Object.entries(shown.offersCsv).map(([policy, csv]) => (
                <Button key={policy} size="sm" variant="secondary" onClick={() => download(`offers-${policy}.csv`, csv, "text/csv")}>
                  offers{Object.keys(shown.offersCsv).length > 1 ? ` (${policy})` : ""}.csv
                </Button>
              ))}
              {Object.entries(shown.seatmapTxt).map(([policy, txt]) => (
                <Button key={policy} size="sm" variant="ghost" onClick={() => download(`seatmap-${policy}.txt`, txt)}>
                  seat map{Object.keys(shown.seatmapTxt).length > 1 ? ` (${policy})` : ""}
                </Button>
              ))}
              <span className="ml-auto font-mono text-[11px]" style={{ color: "var(--fg-faint)" }}>
                {shown.output.runs.length} allocations in {shown.elapsedMs.toFixed(0)} ms
              </span>
            </div>
            <SimulationMarkdown md={shown.reportMd} />
          </Card>
        )}

        {!shown && !compareMd && (
          <Card variant="sunken" className="p-8 text-center">
            <p className="font-sans text-sm" style={{ color: "var(--fg-muted)" }}>
              Pick a venue, describe the crowd, choose the policies to compare, and press Run. The fill report appears here; every run stays in the list so you can compare them.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
