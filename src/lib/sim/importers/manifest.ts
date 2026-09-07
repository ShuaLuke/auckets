// Importer for a box-office seat manifest: one line per seat, with section,
// row, seat, price level and hold group. The Lincoln export is a UTF-16
// tab-separated file with these columns:
//   Section Name, Row Name, SeatName, Price Value, Capacity, Price Level
//   Name, Price Level, Hold Group Name, Hold Name / Offer Name, ...
//
// A manifest describes the building, not a ranking. RowRank is derived —
// price level first (P1 is best), then row letter (double letters like AA
// before A, the pit convention), then the order sections appear — unless a
// sidecar rank file (section,row,rowRank) overrides it. Pure: the CLI reads
// and decodes the file.

import type { VenueRow } from "@/lib/gae/types";

import { parseCsv } from "../pool";
import type { HoldSource, SimVenue } from "../types";
import { SimInputError } from "../venue";
import { slug } from "./cope-rowrank";

export type ManifestOptions = {
  name: string;
  displayName?: string;
  sourceFile?: string;
  importedAt?: string;
  // Seats marked Sold in the snapshot become holds (default: they are open —
  // the manifest is used for the room, not the state of one onsale).
  soldAsHeld?: boolean;
  // Drop hold groups entirely (default: every seat with a hold group is held).
  ignoreHolds?: boolean;
  // Sidecar CSV text "section,row,rowRank" to override the derived ranking.
  rankFileText?: string;
};

export type ManifestImport = {
  venue: SimVenue;
  heldBySource: Record<HoldSource, number>;
  holdGroups: Record<string, number>;
  priceLevels: Record<string, { priceCents: number; seats: number }>;
  soldSeats: number;
};

const ALIASES: Record<string, string[]> = {
  section: ["sectionname", "section"],
  row: ["rowname", "row"],
  seat: ["seatname", "seat", "seatnumber"],
  price: ["pricevalue", "price"],
  level: ["pricelevelname", "pricelevel", "level"],
  holdGroup: ["holdgroupname", "holdgroup", "hold"],
  status: ["holdnameoffername", "status", "offername"],
};

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCol(headers: string[], key: string): number {
  const n = headers.map(norm);
  for (const a of ALIASES[key]!) {
    const i = n.indexOf(a);
    if (i !== -1) return i;
  }
  return -1;
}

// Hold-group codes → who holds the seat. Lincoln uses 1-TECH, 2-HOUS,
// 3-ARTI, 4-MKTG, 5-ADA.
export function holdSourceFor(group: string): HoldSource {
  const g = group.toUpperCase();
  if (g.includes("TECH") || g.includes("PROD")) return "production";
  if (g.includes("ARTI")) return "artist";
  if (g.includes("MKTG") || g.includes("COMP") || g.includes("PROMO")) return "comp";
  return "venue";
}

export function areaFor(section: string): string {
  const s = section.toUpperCase();
  if (s.startsWith("BOX")) return "boxes";
  if (s.startsWith("ORCH") || s.includes("ORCHESTRA")) return "orchestra";
  if (/^F[A-Z]? ?BAL/.test(s) || s.includes("FRONT")) return "front_balcony";
  if (s.includes("BAL")) return "upper_balcony";
  if (s.includes("GA") || s.includes("PIT") || s.includes("FLOOR")) return "ga";
  return slug(section);
}

// Inward lean: a left section leans right (toward centre), and vice versa.
// Side tokens are "L" / "R" possibly with one prefix letter ("FL BAL",
// "CR BAL", "ORCH L", "R BALC"); anything else is centre.
export function leanFor(section: string): VenueRow["lean"] {
  const s = section.toUpperCase();
  if (/(^|\s)[A-Z]?L(\s|$)/.test(s) || s.includes("LEFT")) return "RIGHT";
  if (/(^|\s)[A-Z]?R(\s|$)/.test(s) || s.includes("RIGHT")) return "LEFT";
  return "CENTER";
}

// AA, BB… (pit rows) before A, B…; then alphabetical; GA1-style names last.
function rowNameKey(name: string): [number, string, number] {
  const n = name.toUpperCase();
  if (/^([A-Z])\1$/.test(n)) return [0, n, 0];
  if (/^[A-Z]+$/.test(n)) return [1, n, 0];
  const m = /^([A-Z]*)(\d+)$/.exec(n);
  if (m) return [2, m[1]!, Number(m[2])];
  return [3, n, 0];
}

function compareRowNames(a: string, b: string): number {
  const [ka, sa, na] = rowNameKey(a);
  const [kb, sb, nb] = rowNameKey(b);
  return ka - kb || sa.localeCompare(sb) || na - nb;
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
}

export function venueFromManifest(text: string, opts: ManifestOptions): ManifestImport {
  const table = parseCsv(text, detectDelimiter(text));
  if (table.length < 2) throw new SimInputError("manifest has no data rows");
  const headers = table[0]!;
  const ci = {
    section: findCol(headers, "section"),
    row: findCol(headers, "row"),
    seat: findCol(headers, "seat"),
    price: findCol(headers, "price"),
    level: findCol(headers, "level"),
    holdGroup: findCol(headers, "holdGroup"),
    status: findCol(headers, "status"),
  };
  for (const k of ["section", "row", "seat"] as const) {
    if (ci[k] === -1) throw new SimInputError(`manifest is missing a ${k} column (accepted: ${ALIASES[k]!.join(", ")}). Saw: ${headers.join(", ")}`);
  }
  if (ci.price === -1 && ci.level === -1) throw new SimInputError("manifest needs a price value or price level column to derive tiers and ranking");

  type Seat = { seat: string; priceCents: number; level: string; hold: string; status: string };
  const rowsBySection = new Map<string, Map<string, Seat[]>>();
  const priceLevels: ManifestImport["priceLevels"] = {};
  for (const [i, r] of table.slice(1).entries()) {
    const section = r[ci.section]?.trim() ?? "";
    const row = r[ci.row]?.trim() ?? "";
    const seat = r[ci.seat]?.trim() ?? "";
    if (!section || !row || !seat) throw new SimInputError(`manifest line ${i + 2}: blank section/row/seat`);
    const priceRaw = ci.price === -1 ? "" : (r[ci.price] ?? "").replace(/[$,\s]/g, "");
    const priceCents = priceRaw === "" ? 0 : Math.round(Number(priceRaw) * 100);
    if (!Number.isFinite(priceCents)) throw new SimInputError(`manifest line ${i + 2}: bad price "${r[ci.price]}"`);
    const level = ci.level === -1 ? `$${priceRaw}` : (r[ci.level]?.trim() ?? "");
    const pl = (priceLevels[level] ??= { priceCents, seats: 0 });
    pl.seats += 1;
    if (priceCents < pl.priceCents) pl.priceCents = priceCents;
    const bySec = rowsBySection.get(section) ?? new Map<string, Seat[]>();
    rowsBySection.set(section, bySec);
    const seats = bySec.get(row) ?? [];
    bySec.set(row, seats);
    seats.push({ seat, priceCents, level, hold: ci.holdGroup === -1 ? "" : (r[ci.holdGroup]?.trim() ?? ""), status: ci.status === -1 ? "" : (r[ci.status]?.trim() ?? "") });
  }

  // Sidecar ranks.
  const sidecar = new Map<string, number>();
  if (opts.rankFileText) {
    const t = parseCsv(opts.rankFileText);
    for (const line of t.slice(1)) {
      const [sec, row, rank] = line;
      if (!sec || !row || !rank) continue;
      sidecar.set(`${sec.trim()}|${row.trim()}`, Number(rank));
    }
  }

  // Level order: numeric suffix if present (P1 < P2), else by price desc.
  const levelOrder = new Map<string, number>();
  const levels = Object.entries(priceLevels).sort((a, b) => {
    const na = /(\d+)/.exec(a[0])?.[1];
    const nb = /(\d+)/.exec(b[0])?.[1];
    if (na && nb) return Number(na) - Number(nb);
    return b[1].priceCents - a[1].priceCents;
  });
  levels.forEach(([lvl], i) => levelOrder.set(lvl, i));

  const heldBySource: Record<HoldSource, number> = { venue: 0, artist: 0, comp: 0, production: 0 };
  const holdGroups: Record<string, number> = {};
  let soldSeats = 0;
  const sectionOrder = [...rowsBySection.keys()];

  type Built = { row: VenueRow; sortKey: [number, number, string, number]; sidecarRank: number | undefined };
  const built: Built[] = [];
  const ids = new Set<string>();
  for (const [section, bySec] of rowsBySection) {
    for (const [rowName, seats] of bySec) {
      const allNumeric = seats.every((s) => /^\d+$/.test(s.seat));
      const ordered = allNumeric ? [...seats].sort((a, b) => Number(a.seat) - Number(b.seat)) : seats;
      const holds: string[] = [];
      for (const s of ordered) {
        if (s.hold && !opts.ignoreHolds) {
          holds.push(s.seat);
          heldBySource[holdSourceFor(s.hold)] += 1;
          holdGroups[s.hold] = (holdGroups[s.hold] ?? 0) + 1;
        } else if (opts.soldAsHeld && /sold/i.test(s.status)) {
          holds.push(s.seat);
          heldBySource.venue += 1;
          soldSeats += 1;
        } else if (/sold/i.test(s.status)) soldSeats += 1;
      }
      const minLevel = Math.min(...ordered.map((s) => levelOrder.get(s.level) ?? 99));
      const level = levels[minLevel]?.[0] ?? ordered[0]!.level;
      let id = `${slug(section)}-${slug(rowName)}`;
      if (ids.has(id)) id = `${id}-${built.length}`;
      ids.add(id);
      const seatNumbers = ordered.map((s) => s.seat);
      if (new Set(seatNumbers).size !== seatNumbers.length) throw new SimInputError(`manifest: ${section} ${rowName} lists a seat twice`);
      const isGa = /^GA/i.test(rowName) && seatNumbers.length > 20;
      built.push({
        row: {
          id,
          area: areaFor(section),
          section,
          rowName,
          rowRank: 0,
          capacity: seatNumbers.length,
          parity: seatNumbers.length % 2 === 0 ? "EVEN" : "ODD",
          lean: isGa ? "LEFT" : leanFor(section),
          seatNumbers,
          holds,
          tier: slug(level),
          ...(isGa && { isGa: true }),
        },
        sortKey: [minLevel, 0, rowName, sectionOrder.indexOf(section)],
        sidecarRank: sidecar.get(`${section}|${rowName}`),
      });
    }
  }
  if (sidecar.size > 0) {
    const missing = built.filter((b) => b.sidecarRank === undefined).map((b) => `${b.row.section} ${b.row.rowName}`);
    if (missing.length > 0) throw new SimInputError(`rank file has no entry for: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", …" : ""}`);
    built.sort((a, b) => a.sidecarRank! - b.sidecarRank!);
  } else {
    built.sort((a, b) => a.sortKey[0] - b.sortKey[0] || compareRowNames(a.sortKey[2], b.sortKey[2]) || a.sortKey[3] - b.sortKey[3]);
  }
  built.forEach((b, i) => {
    b.row.rowRank = i + 1;
  });

  const rows = built.map((b) => b.row);
  const floors: Record<string, number> = {};
  for (const [lvl, info] of levels) if (info.priceCents > 0) floors[slug(lvl)] = info.priceCents;
  const held = rows.reduce((s, r) => s + r.holds.length, 0);
  const venue: SimVenue = {
    name: opts.name,
    displayName: opts.displayName ?? `${opts.name} (manifest import)`,
    venueId: opts.name,
    rows,
    activeRowIds: rows.map((r) => r.id),
    notes: `Imported from a box-office seat manifest: ${rows.length} rows, ${rows.reduce((s, r) => s + r.capacity, 0)} seats, ${held} held (${Object.entries(holdGroups).map(([g, n]) => `${g} ${n}`).join(", ") || "no hold groups"}). Tiers are the manifest price levels (${levels.map(([l, i]) => `${l} $${(i.priceCents / 100).toFixed(0)}`).join(", ")}); floors are those prices. RowRank is derived — price level, then row letter (AA before A), then section order — ${sidecar.size > 0 ? "overridden by the supplied rank file" : "adjust with a rank file (section,row,rowRank) if the room disagrees"}. Lean is inward by section name; area is guessed from the section name.${opts.soldAsHeld ? ` ${soldSeats} seats sold in this snapshot are held.` : ""}`,
    source: { kind: "manifest-csv", file: opts.sourceFile, importedAt: opts.importedAt },
  };
  if (Object.keys(floors).length > 0) venue.tierFloorsCents = floors;
  return { venue, heldBySource, holdGroups, priceLevels, soldSeats };
}
