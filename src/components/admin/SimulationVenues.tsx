// The venue tools under the Simulation tab's venue picker: build a new venue
// from tiers, import one from a file, export the selected one as JSON or CSV,
// set the floor prices of a venue you brought, delete it.
//
// Venues made here live in this browser (localStorage) and travel whole with
// each run request — nothing is written on the server. Export a venue to keep
// it or share it; import the file on another machine to get it back.

"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TextInput } from "@/components/ui/TextInput";
import type { SimVenue } from "@/lib/sim/types";
import { decodeText, importVenueFile, nameFromFilename, tiersMissingFloors, venueFromBuilder, venueToCsv, venueToJson, withFloors, type BuilderTier, type VenueFileInput } from "@/lib/sim/venue-io";
import { tierOrder } from "@/lib/sim/venue";

export const CUSTOM_PREFIX = "custom:";
const STORAGE_KEY = "auckets.sim.venues.v1";

export function download(filename: string, text: string, type = "text/plain"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Browser storage can be missing, full or blocked; the tab works without it,
// it just won't remember venues across visits.
export function loadStoredVenues(parse: (raw: unknown) => SimVenue): SimVenue[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: SimVenue[] = [];
    for (const item of list) {
      try {
        out.push(parse(item));
      } catch {
        // A stored venue that no longer validates is dropped, not fatal.
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function storeVenues(venues: SimVenue[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(venues));
    return true;
  } catch {
    return false;
  }
}

export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

type Props = {
  // The selected venue: a library name, or one of yours.
  selected: { kind: "library"; name: string } | { kind: "custom"; venue: SimVenue } | null;
  takenNames: Set<string>;
  onAdd: (venue: SimVenue) => void;
  onUpdate: (venue: SimVenue) => void;
  onDelete: (name: string) => void;
  fetchLibraryVenue: (name: string) => Promise<SimVenue>;
};

type Panel = "none" | "new";

const UNIT_LABEL: Record<BuilderTier["unitType"], string> = { rows: "rows", tables: "tables", boxes: "boxes", ga: "GA (standing)" };

type TierDraft = { name: string; unitType: BuilderTier["unitType"]; count: string; seats: string; floor: string };

const DEFAULT_TIERS: TierDraft[] = [
  { name: "premium", unitType: "rows", count: "5", seats: "20", floor: "150" },
  { name: "standard", unitType: "rows", count: "15", seats: "24", floor: "85" },
];

const selectCls = "w-full rounded-lg border px-2 py-2 font-sans text-sm";
const selectStyle: React.CSSProperties = { borderColor: "var(--border-strong)", background: "var(--page)" };
const linkCls = "font-sans text-xs underline";

export function SimulationVenues({ selected, takenNames, onAdd, onUpdate, onDelete, fetchLibraryVenue }: Props) {
  const [panel, setPanel] = useState<Panel>("none");
  const [displayName, setDisplayName] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>(DEFAULT_TIERS);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [floorsOpen, setFloorsOpen] = useState(false);
  const [floorDraft, setFloorDraft] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const custom = selected?.kind === "custom" ? selected.venue : undefined;
  const missingFloors = custom ? tiersMissingFloors(custom) : [];

  const totalSeats = tiers.reduce((s, t) => s + (t.unitType === "ga" ? 1 : Number(t.count) || 0) * (Number(t.seats) || 0), 0);

  function reset(): void {
    setError(null);
    setMessage(null);
  }

  function create(): void {
    reset();
    try {
      const draft: BuilderTier[] = tiers.map((t) => ({
        name: t.name,
        unitType: t.unitType,
        count: Math.max(1, Math.floor(Number(t.count) || 0)),
        seatsPerUnit: Math.max(1, Math.floor(Number(t.seats) || 0)),
        ...(Number(t.floor) > 0 && { floorCents: Math.round(Number(t.floor) * 100) }),
      }));
      const base = venueFromBuilder({ displayName, tiers: draft });
      const venue = { ...base, name: uniqueName(base.name, takenNames), venueId: uniqueName(base.name, takenNames) };
      onAdd(venue);
      setPanel("none");
      setDisplayName("");
      setTiers(DEFAULT_TIERS);
      setMessage(`Made ${venue.displayName}: ${venue.rows.reduce((s, r) => s + r.capacity, 0).toLocaleString()} seats.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function importFile(file: File): Promise<void> {
    reset();
    setBusy(true);
    try {
      const lower = file.name.toLowerCase();
      let input: VenueFileInput;
      if (/\.(xlsx|xlsm|xls)$/.test(lower)) {
        // Loaded only when someone imports a spreadsheet.
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        input = {
          filename: file.name,
          sheets: wb.SheetNames.map((name) => ({ name, table: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, defval: "", blankrows: false }) })),
        };
      } else {
        input = { filename: file.name, text: decodeText(new Uint8Array(await file.arrayBuffer())) };
      }
      const name = uniqueName(nameFromFilename(file.name), takenNames);
      const { venue, format, notes } = importVenueFile(input, { name, importedAt: new Date().toISOString().slice(0, 10) });
      onAdd({ ...venue, venueId: venue.name });
      setMessage(`Imported ${venue.displayName} from a ${format}: ${venue.rows.length.toLocaleString()} rows, ${venue.rows.reduce((s, r) => s + r.capacity, 0).toLocaleString()} seats.${notes.length > 0 ? ` ${notes.join(" ")}` : ""}`);
      if (notes.length > 0) setFloorsOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function exportAs(kind: "json" | "csv"): Promise<void> {
    if (!selected) return;
    reset();
    setBusy(true);
    try {
      const venue = selected.kind === "custom" ? selected.venue : await fetchLibraryVenue(selected.name);
      if (kind === "json") download(`${venue.name}.json`, venueToJson(venue), "application/json");
      else download(`${venue.name}.csv`, venueToCsv(venue), "text/csv");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function saveFloors(): void {
    if (!custom) return;
    reset();
    const cents: Record<string, number> = {};
    for (const [t, v] of Object.entries(floorDraft)) if (Number(v) > 0) cents[t] = Math.round(Number(v) * 100);
    onUpdate(withFloors(custom, cents));
    setFloorDraft({});
    setFloorsOpen(false);
    setMessage("Floor prices saved.");
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: "var(--fg-muted)" }}>
        <button type="button" className={linkCls} onClick={() => { reset(); setPanel(panel === "new" ? "none" : "new"); }}>
          {panel === "new" ? "Cancel new venue" : "New venue"}
        </button>
        <button type="button" className={linkCls} disabled={busy} onClick={() => fileRef.current?.click()}>
          Import a file
        </button>
        <input ref={fileRef} type="file" className="hidden" accept=".json,.csv,.tsv,.txt,.xlsx,.xlsm,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); }} />
        {selected && (
          <>
            <button type="button" className={linkCls} disabled={busy} onClick={() => void exportAs("json")}>
              Export JSON
            </button>
            <button type="button" className={linkCls} disabled={busy} onClick={() => void exportAs("csv")}>
              Export CSV
            </button>
          </>
        )}
        {custom && (
          <>
            <button type="button" className={linkCls} onClick={() => { reset(); setFloorsOpen((o) => !o); }}>
              Floor prices
            </button>
            <button
              type="button"
              className={linkCls}
              style={{ color: "#8a1f1f" }}
              onClick={() => {
                if (window.confirm(`Remove ${custom.displayName} from this browser? Export it first if you want to keep it.`)) onDelete(custom.name);
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      {custom && missingFloors.length > 0 && !floorsOpen && (
        <p className="mt-2 font-sans text-xs" style={{ color: "#8a1f1f" }}>
          No floor price for {missingFloors.join(", ")} — set floor prices before describing a crowd.
        </p>
      )}

      {custom && floorsOpen && (
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 font-sans text-[12px]" style={{ color: "var(--fg-muted)" }}>
            The lowest offer each tier takes. A described crowd prices its offers up from these.
          </div>
          <div className="grid grid-cols-3 gap-2">
            {tierOrder(custom).map((t) => (
              <Field key={t} label={t.replace(/_/g, " ")} htmlFor={`sim-floor-${t}`}>
                <TextInput id={`sim-floor-${t}`} inputMode="decimal" placeholder={custom.tierFloorsCents?.[t] !== undefined ? String(custom.tierFloorsCents[t] / 100) : ""} value={floorDraft[t] ?? ""} onChange={(e) => setFloorDraft((cur) => ({ ...cur, [t]: e.target.value }))} prefix="$" mono />
              </Field>
            ))}
          </div>
          <div className="mt-2">
            <Button size="sm" onClick={saveFloors}>
              Save floors
            </Button>
          </div>
        </div>
      )}

      {panel === "new" && (
        <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <Field label="Venue name" htmlFor="sim-new-name">
            <TextInput id="sim-new-name" className="w-full" value={displayName} placeholder="e.g. The Fillmore" onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <div className="mb-1 mt-3 font-sans text-[12px]" style={{ color: "var(--fg-muted)" }}>
            Tiers, best first. Every row in a tier gets the same number of seats; for a real seating chart, import the box office&apos;s seat manifest instead.
          </div>
          <div className="flex flex-col gap-2">
            {tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 border-b pb-2" style={{ borderColor: "var(--border)" }}>
                <Field label={`Tier ${i + 1}`} htmlFor={`sim-new-tier-${i}`}>
                  <TextInput id={`sim-new-tier-${i}`} value={t.name} onChange={(e) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </Field>
                <Field label="Made of">
                  <select className={selectCls} style={selectStyle} value={t.unitType} onChange={(e) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, unitType: e.target.value as BuilderTier["unitType"] } : x)))}>
                    {(Object.keys(UNIT_LABEL) as BuilderTier["unitType"][]).map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABEL[u]}
                      </option>
                    ))}
                  </select>
                </Field>
                {t.unitType !== "ga" && (
                  <Field label={`How many ${UNIT_LABEL[t.unitType]}`} htmlFor={`sim-new-count-${i}`}>
                    <TextInput id={`sim-new-count-${i}`} inputMode="numeric" value={t.count} onChange={(e) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} mono />
                  </Field>
                )}
                <Field label={t.unitType === "ga" ? "Capacity" : "Seats in each"} htmlFor={`sim-new-seats-${i}`}>
                  <TextInput id={`sim-new-seats-${i}`} inputMode="numeric" value={t.seats} onChange={(e) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, seats: e.target.value } : x)))} mono />
                </Field>
                <Field label="Floor price" htmlFor={`sim-new-floor-${i}`}>
                  <TextInput id={`sim-new-floor-${i}`} inputMode="decimal" value={t.floor} onChange={(e) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, floor: e.target.value } : x)))} prefix="$" mono />
                </Field>
                {tiers.length > 1 && (
                  <div className="flex items-end">
                    <button type="button" className={linkCls} style={{ color: "var(--fg-muted)" }} onClick={() => setTiers((cur) => cur.filter((_, j) => j !== i))}>
                      Remove tier
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className={linkCls} style={{ color: "var(--fg-muted)" }} onClick={() => setTiers((cur) => [...cur, { name: `tier_${cur.length + 1}`, unitType: "rows", count: "10", seats: "20", floor: "" }])}>
              Add a tier
            </button>
            <span className="ml-auto font-mono text-[11px]" style={{ color: "var(--fg-faint)" }}>
              {totalSeats.toLocaleString()} seats
            </span>
          </div>
          <div className="mt-3">
            <Button size="sm" onClick={create} disabled={!displayName.trim()}>
              Create venue
            </Button>
          </div>
        </div>
      )}

      {message && (
        <p className="mt-2 font-sans text-xs" style={{ color: "var(--fg-muted)" }}>
          {message}
        </p>
      )}
      {error && (
        <div className="mt-2 whitespace-pre-line rounded-lg px-3 py-2 font-sans text-[12px]" style={{ background: "rgba(180, 40, 40, 0.08)", color: "#8a1f1f" }}>
          {error}
        </div>
      )}
    </div>
  );
}
