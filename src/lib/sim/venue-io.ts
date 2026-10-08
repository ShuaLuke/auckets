// Venues in and out of the simulator as files: what the Simulation tab's
// "New venue", "Import" and "Export" buttons run on, and what the CLI writes.
//
// Two export formats:
//   - JSON — the venue file itself (the shape of sim/venues/*.json). Lossless:
//     relief flags, hold labels, wall sections and notes come back as they
//     went out, and a file exported here can be dropped into sim/venues/.
//   - CSV — one line per seat, the shape a box office exports (Section, Row,
//     Seat, Price Level, Price, Hold Group), plus the columns that make it
//     come back as the same room: Area, Row Rank, Lean, GA, On Sale. Opens
//     in Excel or Sheets; edit it and import it again. Relief flags, hold
//     labels and wall sections don't survive a CSV — use JSON for those.
//
// Imports take JSON (a venue file, or a tier spec), a CSV/TSV seat manifest
// (a box office's or our own), or a spreadsheet: a sheet with one line per
// seat is a manifest, otherwise it's read as Cope's RowRank workbook (one line
// per row). Pure: the browser or the CLI reads the file and hands over text
// or sheets.

import { slug, venueFromCopeRowRank, type SheetRow } from "./importers/cope-rowrank";
import { detectDelimiter, venueFromManifestTable } from "./importers/manifest";
import { parseCsv } from "./pool";
import type { SimVenue } from "./types";
import { parseVenueFile, SimInputError, tierOrder, venueFromTierSpec, venueParitySummary } from "./venue";

// --- summaries ---------------------------------------------------------------

export type VenueSummary = {
  name: string;
  displayName: string;
  capacity: number;
  rows: number;
  tiers: string[];
  floorsCents: Record<string, number>;
  // What "sections on sale" offers: the venue's sections, or its areas when
  // there are too many sections to pick from (a stadium has 213). The show
  // overlay matches either.
  sections: string[];
  // Sellable seats in each entry of `sections`, so the form can size a run.
  sectionSeats: Record<string, number>;
  singleRows: number;
  notes: string | undefined;
};

const MAX_SECTION_CHOICES = 40;

export function venueSummary(v: SimVenue): VenueSummary {
  const s = venueParitySummary(v)[0]!;
  const bySection = new Set(v.rows.map((r) => r.section)).size <= MAX_SECTION_CHOICES;
  const sectionSeats: Record<string, number> = {};
  for (const r of v.rows) {
    const key = bySection ? r.section : String(r.area);
    sectionSeats[key] = (sectionSeats[key] ?? 0) + r.capacity - r.holds.length;
  }
  return {
    name: v.name,
    displayName: v.displayName,
    capacity: s.capacity,
    rows: s.activeRows,
    tiers: tierOrder(v),
    floorsCents: v.tierFloorsCents ?? {},
    sections: Object.keys(sectionSeats),
    sectionSeats,
    singleRows: s.singleRows,
    notes: v.notes,
  };
}

// Tiers a generated crowd can't price: no floor set for them.
export function tiersMissingFloors(v: SimVenue): string[] {
  return tierOrder(v).filter((t) => v.tierFloorsCents?.[t] === undefined);
}

// --- size --------------------------------------------------------------------

// A venue you bring travels with every request, so it has to fit in one:
// Vercel refuses a request body over 4.5 MB. Daikin Park (2,381 rows, 43,445
// seats) is about 0.7 MB, so these leave room for a bigger stadium.
export const CUSTOM_VENUE_LIMITS = { rows: 5_000, seats: 80_000 } as const;

export function checkVenueSize(v: Pick<SimVenue, "rows">): string | null {
  const seats = v.rows.reduce((s, r) => s + r.capacity, 0);
  if (v.rows.length > CUSTOM_VENUE_LIMITS.rows) return `${v.rows.length.toLocaleString()} rows is more than the ${CUSTOM_VENUE_LIMITS.rows.toLocaleString()} a venue can have here`;
  if (seats > CUSTOM_VENUE_LIMITS.seats) return `${seats.toLocaleString()} seats is more than the ${CUSTOM_VENUE_LIMITS.seats.toLocaleString()} a venue can have here`;
  return null;
}

// --- export ------------------------------------------------------------------

// Venue files are pretty-printed; a stadium's would be 90,000 lines of seat
// numbers, so big rooms get one row per line instead.
const COMPACT_ROWS_OVER_SEATS = 5000;

export function venueToJson(venue: SimVenue): string {
  const seats = venue.rows.reduce((s, r) => s + r.capacity, 0);
  if (seats <= COMPACT_ROWS_OVER_SEATS) return JSON.stringify(venue, null, 2) + "\n";
  const { rows, activeRowIds, ...rest } = venue;
  const head = JSON.stringify(rest, null, 2).replace(/\n\}$/, "");
  return `${head},\n  "rows": [\n${rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n")}\n  ],\n  "activeRowIds": ${JSON.stringify(activeRowIds)}\n}\n`;
}

export const SEAT_CSV_HEADERS = ["Section", "Row", "Seat", "Price Level", "Price", "Hold Group", "Area", "Row Rank", "Lean", "GA", "On Sale"] as const;

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function venueToCsv(venue: SimVenue): string {
  const active = new Set(venue.activeRowIds);
  const floors = venue.tierFloorsCents ?? {};
  // The import keys rows by section + row name. Generated venues can repeat
  // a row name inside a section ("Table 1" in two table tiers), so those
  // rows get the tier added to their section to stay apart.
  const seen = new Map<string, number>();
  for (const r of venue.rows) seen.set(`${r.section}|${r.rowName}`, (seen.get(`${r.section}|${r.rowName}`) ?? 0) + 1);
  const lines: string[] = [SEAT_CSV_HEADERS.join(",")];
  const ordered = [...venue.rows].sort((a, b) => a.rowRank - b.rowRank);
  for (const r of ordered) {
    const section = (seen.get(`${r.section}|${r.rowName}`) ?? 0) > 1 ? `${r.section} ${r.tier ?? r.id}` : r.section;
    const level = r.tier ?? slug(r.section);
    const floor = floors[level];
    const held = new Set(r.holds);
    const holdGroup = venue.holdLabels?.[r.id] ?? "HOLD";
    for (const seat of r.seatNumbers) {
      lines.push(
        [
          section,
          r.rowName,
          seat,
          level,
          floor === undefined ? "" : (floor / 100).toFixed(2),
          held.has(seat) ? holdGroup : "",
          r.area,
          String(r.rowRank),
          r.lean,
          r.isGa === true ? "yes" : "no",
          active.has(r.id) ? "yes" : "no",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

// --- import ------------------------------------------------------------------

// A file as the browser or CLI hands it over: text for JSON/CSV/TSV, sheets
// (each a table of cells, first line the header) for a spreadsheet.
export type VenueFileInput =
  | { filename: string; text: string }
  | { filename: string; sheets: { name: string; table: unknown[][] }[] };

export type VenueImportOptions = {
  // kebab-case library name; defaults to the file name.
  name?: string;
  displayName?: string;
  importedAt?: string;
};

export function nameFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue";
}

// File bytes → text, honouring a UTF-16 byte-order mark (a Lincoln box-office
// export is UTF-16 tab-separated) and dropping a UTF-8 one.
export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

const norm = (h: unknown): string => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function isSeatTable(table: unknown[][]): boolean {
  const headers = (table[0] ?? []).map(norm);
  return headers.some((h) => h === "seatnumber" || h === "seatname" || h === "seat") && headers.some((h) => h === "row" || h === "rowname");
}

function tableToRows(table: unknown[][]): SheetRow[] {
  const headers = (table[0] ?? []).map((h) => String(h ?? ""));
  return table.slice(1).map((line) => {
    const out: SheetRow = {};
    headers.forEach((h, i) => {
      const c = line[i];
      out[h] = c === "" || c === undefined ? null : (c as SheetRow[string]);
    });
    return out;
  });
}

export type VenueImport = { venue: SimVenue; format: string; notes: string[] };

export function importVenueFile(input: VenueFileInput, opts: VenueImportOptions = {}): VenueImport {
  const name = opts.name ?? nameFromFilename(input.filename);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new SimInputError(`venue name "${name}" must be lowercase letters, digits and dashes`);
  const source = { file: input.filename.replace(/^.*[\\/]/, ""), ...(opts.importedAt && { importedAt: opts.importedAt }) };
  const notes: string[] = [];
  let venue: SimVenue;
  let format: string;

  if ("sheets" in input) {
    const seatSheet = input.sheets.find((s) => isSeatTable(s.table));
    if (seatSheet) {
      format = "seat manifest (spreadsheet)";
      const table = seatSheet.table.map((r) => r.map((c) => String(c ?? "")));
      venue = venueFromManifestTable(table, { name, sourceFile: `${source.file} · sheet "${seatSheet.name}"`, ...(opts.importedAt && { importedAt: opts.importedAt }) }).venue;
    } else {
      const prefer = [/rowrank/i, /architecture/i, /venue/i];
      const sheet = prefer.map((re) => input.sheets.find((s) => re.test(s.name))).find((s) => s !== undefined) ?? input.sheets[0];
      if (!sheet) throw new SimInputError("the spreadsheet has no sheets");
      format = "RowRank workbook";
      venue = venueFromCopeRowRank(tableToRows(sheet.table), { name, sourceFile: `${source.file} · sheet "${sheet.name}"`, ...(opts.importedAt && { importedAt: opts.importedAt }) });
    }
  } else if (/\.json$/i.test(input.filename) || /^\s*\{/.test(input.text)) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(input.text) as Record<string, unknown>;
    } catch (e) {
      throw new SimInputError(`${source.file} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new SimInputError(`${source.file}: expected a venue object`);
    raw.name = name;
    if (typeof raw.displayName !== "string") raw.displayName = name;
    if (Array.isArray(raw.tiers)) {
      format = "tier spec";
      venue = venueFromTierSpec(raw, source.file);
    } else {
      format = "venue file";
      if (typeof raw.venueId !== "string") raw.venueId = name;
      venue = parseVenueFile(raw, source.file);
    }
  } else {
    format = "seat manifest (CSV)";
    const table = parseCsv(input.text, detectDelimiter(input.text)).filter((r) => r.some((c) => c.trim() !== ""));
    venue = venueFromManifestTable(table, { name, sourceFile: source.file, ...(opts.importedAt && { importedAt: opts.importedAt }) }).venue;
  }

  if (opts.displayName) venue = { ...venue, displayName: opts.displayName };
  else if (venue.displayName.endsWith("(manifest import)") || venue.displayName === name) venue = { ...venue, displayName: displayNameFrom(name) };
  venue = { ...venue, source: { ...(venue.source ?? { kind: format }), ...source } };

  const tooBig = checkVenueSize(venue);
  if (tooBig) throw new SimInputError(tooBig);
  const missing = tiersMissingFloors(venue);
  if (missing.length > 0) notes.push(`No floor price for ${missing.join(", ")} — set one before describing a crowd, or the run can't price its offers.`);
  return { venue, format, notes };
}

function displayNameFrom(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

// --- the builder ---------------------------------------------------------------

export type BuilderTier = {
  name: string;
  unitType: "rows" | "tables" | "boxes" | "ga";
  count: number; // rows, tables or boxes; ignored for GA
  seatsPerUnit: number; // seats per row/table/box, or the GA capacity
  floorCents?: number;
};

// The "New venue" form: a name and tiers best-first, each so many rows (or
// tables, boxes) of so many seats. A uniform room — import a manifest for a
// real one.
export function venueFromBuilder(input: { displayName: string; name?: string; tiers: BuilderTier[] }): SimVenue {
  const displayName = input.displayName.trim();
  if (!displayName) throw new SimInputError("give the venue a name");
  const name = input.name ?? (nameFromFilename(displayName) || "venue");
  if (input.tiers.length === 0) throw new SimInputError("add at least one tier");
  const tierNames = input.tiers.map((t) => slug(t.name));
  tierNames.forEach((t, i) => {
    if (!t) throw new SimInputError(`tier ${i + 1} needs a name`);
  });
  if (new Set(tierNames).size !== tierNames.length) throw new SimInputError("tier names must be different from each other");
  const venue = venueFromTierSpec(
    {
      name,
      displayName,
      tiers: input.tiers.map((t, i) => ({
        name: tierNames[i]!,
        rowCount: t.unitType === "ga" ? 1 : t.count,
        seatsPerRow: t.seatsPerUnit,
        unitType: t.unitType,
        ...(t.floorCents !== undefined && { floorCents: t.floorCents }),
      })),
    },
    "new venue",
  );
  const tooBig = checkVenueSize(venue);
  if (tooBig) throw new SimInputError(tooBig);
  return { ...venue, source: { kind: "simulator builder" } };
}

// Floors edited after the fact (an import that carried no prices).
export function withFloors(venue: SimVenue, floorsCents: Record<string, number>): SimVenue {
  const tiers = new Set(venue.rows.map((r) => r.tier).filter((t): t is string => t !== undefined));
  const next: Record<string, number> = {};
  for (const [t, c] of Object.entries({ ...(venue.tierFloorsCents ?? {}), ...floorsCents })) {
    if (tiers.has(t) && Number.isInteger(c) && c > 0) next[t] = c;
  }
  const out: SimVenue = { ...venue };
  delete out.tierFloorsCents;
  if (Object.keys(next).length > 0) out.tierFloorsCents = next;
  return out;
}
