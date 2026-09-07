// Importer for Cope's "RowRank architecture" workbook — the sheet with one
// line per row: GlobalRowRank, Area, DisplaySection, ManifestSection, Row,
// ManifestCapacity, WorkingL, Parity, Lean, PrintedSeatList, HoldSeats,
// SingleInventoryFlag, GapReliefEligible, ActiveStatus, Notes.
//
// Pure: takes the sheet as plain row objects (the CLI does the xlsx read).
// Header names are matched loosely (case, spaces and punctuation ignored),
// so small renames in a future version of his sheet still import.

import type { VenueRow } from "@/lib/gae/types";

import type { SimVenue } from "../types";
import { SimInputError } from "../venue";

export type SheetCell = string | number | boolean | null | undefined;
export type SheetRow = Record<string, SheetCell>;

export type CopeRowRankOptions = {
  name: string;
  displayName?: string;
  // Tier per row: by area (default; "Lower Orchestra" → "lower_orchestra")
  // or by manifest section ("ORCH C" → "orch_c").
  tierBy?: "area" | "section";
  floorsCents?: Record<string, number>;
  sourceFile?: string;
  importedAt?: string;
};

const ALIASES: Record<string, string[]> = {
  rank: ["globalrowrank", "rowrank", "rank"],
  area: ["area"],
  displaySection: ["displaysection", "section"],
  manifestSection: ["manifestsection"],
  row: ["row", "rowname"],
  manifestCapacity: ["manifestcapacity", "capacity"],
  workingL: ["workingl", "l", "availableseats", "working"],
  parity: ["parity"],
  lean: ["lean"],
  seats: ["printedseatlist", "seatlist", "seats", "printedseats"],
  holdSeats: ["holdseats", "holds"],
  single: ["singleinventoryflag", "single", "singlerow"],
  gapRelief: ["gapreliefeligible", "gaprelief", "relief"],
  active: ["activestatus", "active", "status"],
  notes: ["notes", "note"],
};

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Well-known area labels collapse onto the engine's AreaLabel vocabulary so
// "Lower Orchestra" and "ORCH" both become "orchestra"; anything else slugs.
export function canonicalArea(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("box")) return "boxes";
  if (l.includes("orch")) return "orchestra";
  if (l.includes("bal") && (l.includes("front") || l.includes("mezz") || l.includes("loge"))) return "front_balcony";
  if (l.includes("bal")) return "upper_balcony";
  if (/(^|\W)(ga|pit|floor|lawn|standing)(\W|$)/.test(l)) return "ga";
  return slug(label);
}

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function columnMap(headers: string[]): Map<string, string> {
  const normalized = new Map(headers.map((h) => [norm(h), h]));
  const out = new Map<string, string>();
  for (const [key, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const h = normalized.get(a);
      if (h !== undefined) {
        out.set(key, h);
        break;
      }
    }
  }
  return out;
}

function str(v: SheetCell): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function int(v: SheetCell, what: string, line: number): number {
  const n = Number(str(v));
  if (!Number.isFinite(n)) throw new SimInputError(`row ${line}: ${what} is "${str(v)}", not a number`);
  return Math.round(n);
}

function yes(v: SheetCell): boolean {
  return /^(yes|y|true|1|active)/i.test(str(v));
}

export function venueFromCopeRowRank(rows: SheetRow[], opts: CopeRowRankOptions): SimVenue {
  if (rows.length === 0) throw new SimInputError("RowRank sheet has no rows");
  const cols = columnMap(Object.keys(rows[0]!));
  for (const required of ["rank", "area", "row", "workingL", "lean", "seats"]) {
    if (!cols.has(required)) {
      throw new SimInputError(
        `RowRank sheet is missing a "${required}" column (accepted names: ${ALIASES[required]!.join(", ")}). Saw: ${Object.keys(rows[0]!).join(", ")}`,
      );
    }
  }
  const get = (r: SheetRow, key: string): SheetCell => {
    const h = cols.get(key);
    return h === undefined ? undefined : r[h];
  };

  const venueRows: VenueRow[] = [];
  const activeRowIds: string[] = [];
  const relief: NonNullable<SimVenue["relief"]> = {};
  const ids = new Set<string>();

  rows.forEach((r, i) => {
    const line = i + 2;
    if (str(get(r, "rank")) === "" && str(get(r, "row")) === "") return; // blank trailing line
    const rank = int(get(r, "rank"), "GlobalRowRank", line);
    const area = str(get(r, "area"));
    const manifestSection = str(get(r, "manifestSection"));
    const displaySection = str(get(r, "displaySection"));
    const section = manifestSection || displaySection || area;
    const rowName = str(get(r, "row"));
    const workingL = int(get(r, "workingL"), "WorkingL", line);
    const seats = str(get(r, "seats"))
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s !== "");
    if (seats.length !== workingL) {
      const manifestCap = cols.has("manifestCapacity") ? int(get(r, "manifestCapacity"), "ManifestCapacity", line) : undefined;
      const hint =
        manifestCap !== undefined && seats.length === manifestCap
          ? ` The list has all ${manifestCap} manifest seats; list only the ${workingL} working seats (as rows V–Y do) so the sim knows which are held.`
          : "";
      throw new SimInputError(`row ${line} (${section} ${rowName}): PrintedSeatList has ${seats.length} seats but WorkingL is ${workingL}.${hint}`);
    }
    if (new Set(seats).size !== seats.length) throw new SimInputError(`row ${line} (${section} ${rowName}): duplicate printed seat numbers`);

    let id = `${slug(section)}-${slug(rowName)}`;
    if (ids.has(id)) id = `${id}-${rank}`;
    if (ids.has(id)) throw new SimInputError(`row ${line}: duplicate row id "${id}"`);
    ids.add(id);

    const leanRaw = str(get(r, "lean")).toLowerCase();
    const lean: VenueRow["lean"] = leanRaw.startsWith("l") ? "LEFT" : leanRaw.startsWith("r") ? "RIGHT" : leanRaw.startsWith("d") ? "DUAL_AISLE" : "CENTER";
    const parityRaw = str(get(r, "parity")).toUpperCase();
    const parity: VenueRow["parity"] = parityRaw === "ODD" || parityRaw === "EVEN" ? parityRaw : workingL % 2 === 0 ? "EVEN" : "ODD";
    const areaKey = canonicalArea(area);
    const tier = opts.tierBy === "section" ? slug(section) : areaKey;

    venueRows.push({
      id,
      area: areaKey,
      section,
      rowName,
      rowRank: rank,
      capacity: workingL,
      parity,
      lean,
      seatNumbers: seats,
      holds: [],
      tier,
      isGa: false,
    });
    const activeCell = get(r, "active");
    if (activeCell === undefined || str(activeCell) === "" || yes(activeCell)) activeRowIds.push(id);
    const single = yes(get(r, "single"));
    const gap = yes(get(r, "gapRelief"));
    if (single || gap) relief[id] = { ...(single && { single: true }), ...(gap && { gapRelief: true }) };
  });

  if (venueRows.length === 0) throw new SimInputError("RowRank sheet has no usable rows");
  const ranks = new Set(venueRows.map((r) => r.rowRank));
  if (ranks.size !== venueRows.length) throw new SimInputError("GlobalRowRank values are not unique");

  const tiers = [...new Set(venueRows.map((r) => r.tier!))];
  const capacity = venueRows.reduce((s, r) => s + r.capacity, 0);
  const venue: SimVenue = {
    name: opts.name,
    displayName: opts.displayName ?? `${opts.name} (Cope RowRank import)`,
    venueId: opts.name,
    rows: venueRows,
    activeRowIds,
    relief,
    notes: `Imported from a Cope RowRank architecture sheet: ${venueRows.length} rows, ${capacity} working seats, tiers by ${opts.tierBy ?? "area"} (${tiers.join(", ")}). Held seats are those his sheet already excludes from WorkingL; relief flags are SingleInventoryFlag / GapReliefEligible.${opts.floorsCents ? "" : " No tier floors set — pass --floors or set show.floorsCents before generating pools."}`,
    source: { kind: "cope-rowrank-xlsx", file: opts.sourceFile, importedAt: opts.importedAt },
  };
  if (opts.floorsCents) {
    for (const t of tiers) {
      if (opts.floorsCents[t] === undefined) throw new SimInputError(`--floors is missing tier "${t}" (tiers in this sheet: ${tiers.join(", ")})`);
    }
    venue.tierFloorsCents = opts.floorsCents;
  }
  return venue;
}
