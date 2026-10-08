// The Simulation tab. Pick a library venue or bring your own (build, import,
// export — see SimulationVenues), describe a crowd, run the real engine
// through POST /api/admin/simulation, read the fill report, keep the run,
// compare runs. Runs stay in this page's state and your venues in this
// browser — nothing is written on the server, nothing touches a real show.

"use client";

import { useEffect, useMemo, useState } from "react";

import { SimulationMarkdown } from "@/components/admin/SimulationMarkdown";
import { BaseMethodology, PolicyMethodology } from "@/components/admin/SimulationMethodology";
import { SimulationRoi } from "@/components/admin/SimulationRoi";
import { SimulationRoomMap } from "@/components/admin/SimulationRoomMap";
import { SimulationRoomRules } from "@/components/admin/SimulationRoomRules";
import { CUSTOM_PREFIX, download, loadStoredVenues, SimulationVenues, storeVenues } from "@/components/admin/SimulationVenues";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { TextInput } from "@/components/ui/TextInput";
import { checkWork } from "@/lib/sim/budget";
import { compareRuns, renderComparison } from "@/lib/sim/compare";
import { usd } from "@/lib/sim/format";
import type { LibraryPoolSummary, LibraryVenueSummary } from "@/lib/sim/library";
import { compareToBaseline } from "@/lib/sim/roi";
import type { RoomRules, SeatMapView, SectionMapView } from "@/lib/sim/seatmap";
import type { RunOutput, SimVenue } from "@/lib/sim/types";
import { parseVenueFile } from "@/lib/sim/venue";
import { venueSummary } from "@/lib/sim/venue-io";

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
  seatMaps: Record<string, SeatMapView>;
  downloadsOmitted: string[];
  seatMapsOmitted: string[];
  sectionMaps: Record<string, SectionMapView>;
  // What was sent, so a section's seats can be fetched later by replaying it.
  requestBody: Record<string, unknown>;
  elapsedMs: number;
};

// The empty room for the venue, sections and holds the form is set to —
// what a venue sees before any crowd. Keyed by those inputs so a change in
// the form fetches it again.
type Room = {
  key: string;
  view: SeatMapView | undefined;
  sections: SectionMapView;
  rules: RoomRules;
};

const POLICIES: { key: string; label: string; hint: string }[] = [
  { key: "first-come", label: "First-come at face price (the old way)", hint: "What a venue does today: fixed tier prices, best available seats to whoever arrives first. Not the engine — the comparison." },
  { key: "greedy", label: "Auckets — rank order (what production runs)", hint: "Best offer takes the best row it fits in, then the next. Rank-first." },
  { key: "clean-fit", label: "Clean-fit", hint: "Defers a fitting group that would strand seats. Widens rank-respect by those deferrals." },
  { key: "lookahead", label: "Lookahead (Cope's Phase 6)", hint: "Looks two rows ahead; defers at most one offer per row. Fill-first, not rank-first." },
  { key: "parity-tiebreak", label: "Parity tiebreak", hint: "Reorders only at equal price so odd groups meet odd remainders." },
  { key: "singles-reserve", label: "Singles reserve", hint: "Holds back the lowest-ranked singles for 1-seat rows. Not rank-first." },
  { key: "clean-fit+singles-reserve", label: "Clean-fit + singles reserve", hint: "The combination that filled the Lincoln to 99.8%." },
  { key: "protect-units", label: "Protect tables/boxes", hint: "One group per table or box (NEW-14). Only matters on venues with tables." },
];

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

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
  // The old way's price per tier, in dollars; empty = the tier floor.
  const [facePrices, setFacePrices] = useState<Record<string, string>>({});
  const [firstComeArrival, setFirstComeArrival] = useState<"random" | "as-submitted">("random");
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
  const [resultView, setResultView] = useState<"report" | "map" | "room">("report");
  const [mapPolicy, setMapPolicy] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  // Venues brought by this user: built or imported here, kept in this
  // browser, sent whole with each request. Selected as "custom:<name>".
  const [customVenues, setCustomVenues] = useState<SimVenue[]>([]);
  const [storageWarning, setStorageWarning] = useState(false);
  useEffect(() => {
    setCustomVenues(loadStoredVenues((raw) => parseVenueFile(raw, "stored venue")));
  }, []);
  function saveCustomVenues(next: SimVenue[]): void {
    setCustomVenues(next);
    setStorageWarning(!storeVenues(next));
  }
  const custom = venue.startsWith(CUSTOM_PREFIX) ? customVenues.find((v) => v.name === venue.slice(CUSTOM_PREFIX.length)) : undefined;
  const customInfo = useMemo(() => (custom ? venueSummary(custom) : undefined), [custom]);
  const venueInfo = customInfo ?? venues.find((v) => v.name === venue);
  // What the request names: a library venue by name, or yours in full.
  const venueRef: string | SimVenue = custom ?? venue;
  const takenNames = useMemo(() => new Set([...venues.map((v) => v.name), ...customVenues.map((v) => v.name)]), [venues, customVenues]);

  function selectVenue(value: string): void {
    setVenue(value);
    setActiveSections([]);
    setHoldTier("");
    setFacePrices({});
  }

  async function fetchLibraryVenue(name: string): Promise<SimVenue> {
    const res = await fetch("/api/admin/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exportVenue: name }) });
    const json = (await res.json().catch(() => ({}))) as Partial<{ ok: true; venue: SimVenue; error: string }>;
    if (!res.ok || !json.venue) throw new Error(json.error ?? `Could not load the venue (HTTP ${res.status})`);
    return json.venue;
  }
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
  // The same check the route enforces, so the form can say so before the run.
  // Holds are not counted here; the route counts them.
  const onSaleSeats = venueInfo ? (activeSections.length > 0 ? activeSections.reduce((n, sec) => n + (venueInfo.sectionSeats[sec] ?? 0), 0) : venueInfo.capacity) : 0;
  const poolTickets = pools.find((p) => p.name === poolName)?.tickets ?? 0;
  const work = checkWork({
    onSaleSeats,
    oversubscription: poolKind === "library" ? poolTickets / Math.max(1, onSaleSeats) : Number(oversub) || 1,
    policies,
    seeds: poolKind === "library" ? 1 : Number(seeds) || 1,
    previews,
  });
  const allocations = work.allocations;

  async function run(): Promise<void> {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const groupSizeMix = preset !== "custom" ? preset : Object.fromEntries(SIZES.filter((z) => Number(mix[z]) > 0).map((z) => [String(z), Number(mix[z])]));
      const body = {
        venue: venueRef,
        ...(activeSections.length > 0 && { activeSections }),
        ...(holdTier && Number(holdSeats) > 0 && { holds: [{ source: "artist", tier: holdTier, seats: Number(holdSeats) }] }),
        ...(policies.includes("first-come") && { firstComeArrival }),
        ...(policies.includes("first-come") && Object.values(facePrices).some((v) => Number(v) > 0) && { facePricesCents: Object.fromEntries(Object.entries(facePrices).filter(([, v]) => Number(v) > 0).map(([t, v]) => [t, Math.round(Number(v) * 100)])) }),
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
      const json = (await res.json().catch(() => ({}))) as Partial<{ ok: true; output: RunOutput; reportMd: string; offersCsv: Record<string, string>; seatmapTxt: Record<string, string>; seatMaps: Record<string, SeatMapView>; sectionMaps: Record<string, SectionMapView>; downloadsOmitted: string[]; seatMapsOmitted: string[]; elapsedMs: number; error: string; details: { path: (string | number)[]; message: string }[] }>;
      if (!res.ok || !json.ok || !json.output) {
        const detail = json.details?.map((d) => `${d.path.join(".")}: ${d.message}`).join("; ");
        setError(json.error ? `${json.error}${detail ? ` — ${detail}` : ""}` : `Failed (HTTP ${res.status})`);
        return;
      }
      const id = `run-${Date.now()}`;
      const label = `${venueInfo?.displayName.split(" —")[0] ?? venue} · ${poolKind === "library" ? poolName : `${preset === "custom" ? "custom mix" : preset} ×${oversub}`} · ${policies.join(", ")}${timelineOn ? ` · ${windowDays}d window` : ""}`;
      const saved: SavedRun = { id, label, at: new Date().toLocaleTimeString(), output: json.output, reportMd: json.reportMd ?? "", offersCsv: json.offersCsv ?? {}, seatmapTxt: json.seatmapTxt ?? {}, seatMaps: json.seatMaps ?? {}, downloadsOmitted: json.downloadsOmitted ?? [], seatMapsOmitted: json.seatMapsOmitted ?? [], sectionMaps: json.sectionMaps ?? {}, requestBody: body, elapsedMs: json.elapsedMs ?? 0 };
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
  const mapPolicies = shown ? Object.keys(shown.sectionMaps) : [];

  const roomBody = useMemo(
    () => ({
      room: true as const,
      venue: venueRef,
      ...(activeSections.length > 0 && { activeSections }),
      ...(holdTier && Number(holdSeats) > 0 && { holds: [{ source: "artist" as const, tier: holdTier, seats: Number(holdSeats) }] }),
    }),
    [venueRef, activeSections, holdTier, holdSeats],
  );
  // Keyed by the picker value, not the venue itself: a venue of yours can be
  // a stadium, and its seats don't change after it's made (floors don't
  // change the room).
  const roomKey = JSON.stringify({ ...roomBody, venue });
  const roomStale = room === null || room.key !== roomKey;
  useEffect(() => {
    if (resultView !== "room" || !roomStale || roomLoading) return;
    let cancelled = false;
    setRoomLoading(true);
    setRoomError(null);
    void (async () => {
      try {
        const res = await fetch("/api/admin/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(roomBody) });
        const json = (await res.json().catch(() => ({}))) as Partial<{ ok: true; room: SeatMapView; sections: SectionMapView; rules: RoomRules; error: string }>;
        if (cancelled) return;
        if (!res.ok || !json.ok || !json.sections || !json.rules) {
          setRoomError(json.error ?? `Could not load the room (HTTP ${res.status})`);
          return;
        }
        setRoom({ key: roomKey, view: json.room, sections: json.sections, rules: json.rules });
      } catch (e) {
        if (!cancelled) setRoomError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setRoomLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // roomKey stands in for roomBody; roomLoading is deliberately not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultView, roomKey, roomStale]);

  async function loadRoomArea(area: string): Promise<SeatMapView> {
    const res = await fetch("/api/admin/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...roomBody, area }) });
    const json = (await res.json().catch(() => ({}))) as Partial<{ ok: true; room: SeatMapView; error: string }>;
    if (!res.ok || !json.room) throw new Error(json.error ?? `Could not load the seats (HTTP ${res.status})`);
    return json.room;
  }

  const roomCard = (
    <div>
      <div className="mb-3 font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
        <strong style={{ color: "var(--fg)" }}>{venueInfo?.displayName.split(" —")[0] ?? venue}</strong> before anyone is seated, with the sections and holds set on the left. This is the room the engine starts from: every row carries the venue&apos;s rank, and the rules below say how it fills.
      </div>
      {roomError ? (
        <p className="font-sans text-[13px]" style={{ color: "#8a1f1f" }}>
          {roomError}
        </p>
      ) : room === null || roomStale ? (
        <p className="font-sans text-[13px]" style={{ color: "var(--fg-muted)" }}>
          Loading the room…
        </p>
      ) : (
        <>
          <SimulationRoomMap key={room.key} sections={room.sections} view={room.view} loadArea={loadRoomArea} />
          <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <Eyebrow className="mb-3">How this room fills</Eyebrow>
            <SimulationRoomRules rules={room.rules} />
          </div>
        </>
      )}
    </div>
  );
  const shownPolicy = mapPolicy !== null && mapPolicies.includes(mapPolicy) ? mapPolicy : mapPolicies[0];
  const shownSections = shown && shownPolicy !== undefined ? shown.sectionMaps[shownPolicy] : undefined;
  // The old way beside the engine policy being looked at (first seed of each).
  const oldWay = shown?.output.runs.find((r) => r.metrics.firstCome && r.seed === shown.output.seeds[0]);
  const ourPolicy = shownPolicy !== undefined && shownPolicy !== "first-come" ? shownPolicy : mapPolicies.find((p) => p !== "first-come");
  const ours = oldWay && ourPolicy !== undefined ? shown?.output.runs.find((r) => r.policy === ourPolicy && r.seed === oldWay.seed) : undefined;
  const roi = oldWay && ours ? compareToBaseline(oldWay, ours) : undefined;

  // Seat detail for one level of a run whose seat map was too big to send:
  // replay the run's own request with `detail` set. Same inputs, same seats.
  async function loadArea(run: SavedRun, policy: string, area: string): Promise<SeatMapView> {
    const res = await fetch("/api/admin/simulation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...run.requestBody, detail: { policy, area } }) });
    const json = (await res.json().catch(() => ({}))) as Partial<{ ok: true; detail: SeatMapView; error: string }>;
    if (!res.ok || !json.detail) throw new Error(json.error ?? `Could not load the seats (HTTP ${res.status})`);
    return json.detail;
  }
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
          <select id="sim-venue" className="w-full rounded-lg border px-3 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={venue} onChange={(e) => selectVenue(e.target.value)}>
            <optgroup label="Library">
              {venues.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.displayName} — {v.capacity.toLocaleString()} seats
                </option>
              ))}
            </optgroup>
            {customVenues.length > 0 && (
              <optgroup label="Your venues (this browser)">
                {customVenues.map((v) => (
                  <option key={v.name} value={`${CUSTOM_PREFIX}${v.name}`}>
                    {v.displayName} — {venueSummary(v).capacity.toLocaleString()} seats
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <SimulationVenues
          selected={custom ? { kind: "custom", venue: custom } : venues.some((v) => v.name === venue) ? { kind: "library", name: venue } : null}
          takenNames={takenNames}
          onAdd={(v) => {
            saveCustomVenues([...customVenues, v]);
            selectVenue(`${CUSTOM_PREFIX}${v.name}`);
          }}
          onUpdate={(v) => saveCustomVenues(customVenues.map((x) => (x.name === v.name ? v : x)))}
          onDelete={(name) => {
            saveCustomVenues(customVenues.filter((x) => x.name !== name));
            selectVenue(venues[0]?.name ?? "");
          }}
          fetchLibraryVenue={fetchLibraryVenue}
        />
        {storageWarning && (
          <p className="mt-1 font-sans text-xs" style={{ color: "#8a1f1f" }}>
            This browser couldn&apos;t save your venues, so they&apos;ll be gone when you leave the page. Export them to keep them.
          </p>
        )}
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
        <div className="mb-3">
          <BaseMethodology />
        </div>
        <div className="flex flex-col gap-2">
          {POLICIES.map((p) => (
            <div key={p.key} className="flex items-start gap-2 font-sans text-[13px]">
              <input id={`sim-policy-${p.key}`} type="checkbox" className="mt-0.5" checked={policies.includes(p.key)} onChange={() => togglePolicy(p.key)} />
              <div className="min-w-0 flex-1">
                <label htmlFor={`sim-policy-${p.key}`} className="cursor-pointer">
                  {p.label}
                  <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                    {p.hint}
                  </span>
                </label>
                <div className="mt-0.5">
                  <PolicyMethodology name={p.key} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {policies.includes("first-come") && venueInfo && (
          <div className="mt-4">
            <div className="mb-1.5 font-sans text-[12px]" style={{ color: "var(--fg-muted)" }}>
              Face prices for the old way, per tier. Blank means the tier floor — set them to what the venue would really charge.
            </div>
            <div className="grid grid-cols-3 gap-2">
              {venueInfo.tiers.map((t) => (
                <Field key={t} label={t.replace(/_/g, " ")} htmlFor={`sim-face-${t}`}>
                  <TextInput id={`sim-face-${t}`} inputMode="decimal" placeholder={venueInfo.floorsCents[t] !== undefined ? String(venueInfo.floorsCents[t]! / 100) : ""} value={facePrices[t] ?? ""} onChange={(e) => setFacePrices((cur) => ({ ...cur, [t]: e.target.value }))} prefix="$" mono />
                </Field>
              ))}
            </div>
            <div className="mt-2">
              <Field label="Fans arrive" hint="Who reaches the box office first has nothing to do with what they'd pay. Cope's pool file is numbered in price order, so ‘as submitted’ would make the old way look like rank order.">
                <select className="w-full rounded-lg border px-2 py-2 font-sans text-sm" style={{ borderColor: "var(--border-strong)", background: "var(--page)" }} value={firstComeArrival} onChange={(e) => setFirstComeArrival(e.target.value as "random" | "as-submitted")}>
                  <option value="random">in a random order (seeded)</option>
                  <option value="as-submitted">in the pool&apos;s submitted order</option>
                </select>
              </Field>
            </div>
          </div>
        )}

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
            {onSaleSeats > 5000 ? ` · about ${Math.max(1, Math.round(work.estimatedMs / 1000))} s of work` : ""}
            {work.ok ? "" : ` — ${work.message}`}
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
            {(shown.downloadsOmitted.length > 0 || shown.seatMapsOmitted.length > 0) && (
              <p className="mb-3 font-sans text-xs" style={{ color: "var(--fg-muted)" }}>
                In a room this size not everything fits in one response.
                {shown.downloadsOmitted.length > 0 && ` No offers.csv or seat map download for ${shown.downloadsOmitted.join(", ")} — run a policy on its own to get its files.`}
                {shown.seatMapsOmitted.length > 0 && ` The seat map for ${shown.seatMapsOmitted.join(", ")} opens by section, and loads a level's seats when you open one.`} The fill report covers every policy.
              </p>
            )}
            {mapPolicies.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <Button size="sm" variant={resultView === "room" ? "primary" : "secondary"} onClick={() => setResultView("room")}>
                  The room
                </Button>
                <Button size="sm" variant={resultView === "report" ? "primary" : "secondary"} onClick={() => setResultView("report")}>
                  Fill report
                </Button>
                <Button size="sm" variant={resultView === "map" ? "primary" : "secondary"} onClick={() => setResultView("map")}>
                  Seat map
                </Button>
                {(resultView === "map" || roi !== undefined) && mapPolicies.length > 1 && (
                  <span className="ml-2 flex flex-wrap items-center gap-1">
                    {mapPolicies.map((p) => {
                      const on = shownPolicy === p;
                      return (
                        <button key={p} type="button" aria-pressed={on} className="rounded-full border px-2 py-0.5 font-sans text-[11px]" style={{ borderColor: on ? "var(--ink-900)" : "var(--border)", background: on ? "var(--ink-900)" : "transparent", color: on ? "var(--paper)" : "var(--fg-muted)" }} onClick={() => setMapPolicy(p)}>
                          {p}
                        </button>
                      );
                    })}
                  </span>
                )}
              </div>
            )}
            {resultView !== "room" && shownPolicy !== undefined && (
              <div className="mb-4">
                <PolicyMethodology name={shownPolicy} />
              </div>
            )}
            {resultView === "room" ? (
              roomCard
            ) : resultView === "map" && shownSections && shownPolicy !== undefined ? (
              <SimulationRoomMap key={`${shown.id}/${shownPolicy}`} sections={shownSections} view={shown.seatMaps[shownPolicy]} loadArea={(area) => loadArea(shown, shownPolicy, area)} />
            ) : (
              <>
                {roi && (
                  <div className="mb-6 border-b pb-6" style={{ borderColor: "var(--border)" }}>
                    <Eyebrow className="mb-3">The old way vs Auckets</Eyebrow>
                    <SimulationRoi roi={roi} />
                  </div>
                )}
                <SimulationMarkdown md={shown.reportMd} />
              </>
            )}
          </Card>
        )}

        {!shown && !compareMd && resultView === "room" && <Card className="p-5">{roomCard}</Card>}

        {!shown && !compareMd && resultView !== "room" && (
          <Card variant="sunken" className="p-8 text-center">
            <p className="font-sans text-sm" style={{ color: "var(--fg-muted)" }}>
              Pick a venue, describe the crowd, choose the policies to compare, and press Run. The fill report appears here; every run stays in the list so you can compare them.
            </p>
            <div className="mt-4">
              <Button size="sm" variant="secondary" onClick={() => setResultView("room")}>
                Or look at the room first
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
