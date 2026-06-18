// Self-contained trial runner for the pure GAE.
//
// Supersedes the untracked scripts/sim-allocate.ts for this fixture suite:
// same CSV interface, but committed alongside the fixtures AND able to load a
// custom venue (so holds / lean / partial-activation cases are testable) and
// render a per-SEAT map (so lean placement is actually visible).
//
//   npx tsx scripts/trial-fixtures/run.ts <bids.csv>
//   npx tsx scripts/trial-fixtures/run.ts <bids.csv> --price=cents
//   npx tsx scripts/trial-fixtures/run.ts <bids.csv> --venue=scripts/trial-fixtures/venue_holds.json
//
// CSV columns (case-insensitive, several aliases): groupSize | size | party | qty,
// price | bid | offer (DOLLARS unless --price=cents), tier (optional), id (optional).
// Tier tokens: "premium"/"mid"/"ga" (exact), trailing "+" = this_or_better,
// trailing "-" = this_or_worse, "any"/"*" = anywhere.
//
// --venue JSON is a VenueArchitecture: { venueId?, rows: VenueRow[], activeRowIds? }
// (activeRowIds defaults to every row id). Default venue = seeded "Cope's place".

import { readFileSync } from "node:fs";

import { allocate } from "../../src/lib/gae/index";
import { computeRankKey, sortRankedOffers } from "../../src/lib/gae/rankkey";
import type {
  AllocationConfig,
  RankedOffer,
  TierPreference,
  VenueArchitecture,
  VenueRow,
} from "../../src/lib/gae/types";

// --- Default venue: the seeded "Cope's place" (50 seats) --------------------

function range(start: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(start + i));
}

const COPES_PLACE: VenueArchitecture = {
  venueId: "sim-venue",
  rows: [
    { id: "row_a", area: "orchestra", section: "main", rowName: "A", rowRank: 1, capacity: 8, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 8), holds: [], tier: "premium", isGa: false },
    { id: "row_b", area: "orchestra", section: "main", rowName: "B", rowRank: 2, capacity: 8, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 8), holds: [], tier: "premium", isGa: false },
    { id: "row_c", area: "orchestra", section: "main", rowName: "C", rowRank: 3, capacity: 6, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 6), holds: [], tier: "mid", isGa: false },
    { id: "row_d", area: "orchestra", section: "main", rowName: "D", rowRank: 4, capacity: 6, parity: "EVEN", lean: "CENTER", seatNumbers: range(1, 6), holds: [], tier: "mid", isGa: false },
    { id: "row_ga", area: "ga", section: "ga", rowName: "GA", rowRank: 5, capacity: 22, parity: "EVEN", lean: "CENTER", seatNumbers: Array.from({ length: 22 }, (_, i) => `GA-${i + 1}`), holds: [], tier: "ga", isGa: true },
  ],
  activeRowIds: ["row_a", "row_b", "row_c", "row_d", "row_ga"],
};

const CONFIG: AllocationConfig = {
  mode: "preview",
  allowOrphans: false,
  maxGroupSize: 10,
  orphanPolicy: "leave",
};

function loadVenue(path: string): VenueArchitecture {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<VenueArchitecture>;
  if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
    throw new Error(`--venue ${path}: missing a non-empty "rows" array`);
  }
  return {
    venueId: raw.venueId ?? "custom-venue",
    rows: raw.rows as VenueRow[],
    activeRowIds: raw.activeRowIds ?? (raw.rows as VenueRow[]).map((r) => r.id),
  };
}

// --- CSV parsing (no deps; handles quoted fields) ---------------------------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); field = ""; row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const COLUMN_ALIASES: Record<string, string[]> = {
  groupSize: ["groupsize", "size", "party", "partysize", "qty", "quantity", "seats", "tickets"],
  price: ["price", "bid", "priceperticket", "priceperticketcents", "offer", "amount", "ppt"],
  tier: ["tier", "tierpref", "tierpreference", "preference", "section"],
  id: ["id", "offerid", "bidid"],
};

function findColumn(headers: string[], key: string): number {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ""));
  for (const alias of COLUMN_ALIASES[key]!) {
    const idx = norm.indexOf(alias.replace(/[\s_]/g, ""));
    if (idx !== -1) return idx;
  }
  return -1;
}

function toCents(raw: string, mode: "dollars" | "cents"): number {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (mode === "cents") return Math.round(Number(cleaned));
  const [dollars, frac = ""] = cleaned.split(".");
  const cents = (frac + "00").slice(0, 2);
  return Number(dollars) * 100 + Number(cents);
}

function parseTierPref(raw: string | undefined): TierPreference {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return { type: "any" };
  if (t.endsWith("+")) return { type: "this_or_better", tier: t.slice(0, -1) };
  if (t.endsWith("-")) return { type: "this_or_worse", tier: t.slice(0, -1) };
  if (["any", "*", "either"].includes(t)) return { type: "any" };
  return { type: "specific", tier: t };
}

// --- Reporting --------------------------------------------------------------

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const csvPath = args.find((a) => !a.startsWith("--"));
  const priceMode = args.includes("--price=cents") ? "cents" : "dollars";
  const venueArg = args.find((a) => a.startsWith("--venue="))?.slice("--venue=".length);
  if (!csvPath) {
    console.error("Usage: npx tsx scripts/trial-fixtures/run.ts <bids.csv> [--price=cents] [--venue=path.json]");
    process.exit(1);
  }

  const venue = venueArg ? loadVenue(venueArg) : COPES_PLACE;
  const activeRows = venue.rows
    .filter((r) => venue.activeRowIds.includes(r.id))
    .sort((a, b) => a.rowRank - b.rowRank);
  const totalCap = activeRows.reduce((s, r) => s + (r.capacity - r.holds.length), 0);

  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  if (rows.length < 2) { console.error("CSV has no data rows."); process.exit(1); }

  const headers = rows[0]!;
  const gi = findColumn(headers, "groupSize");
  const pi = findColumn(headers, "price");
  const ti = findColumn(headers, "tier");
  const idi = findColumn(headers, "id");
  if (gi === -1 || pi === -1) {
    console.error(`Could not find required columns. Saw headers: ${headers.join(", ")}`);
    process.exit(1);
  }

  const base = new Date("2026-01-01T00:00:00Z").getTime();
  const offers: RankedOffer[] = rows.slice(1).map((r, idx) => {
    const groupSize = Math.round(Number(r[gi]!.trim()));
    const pricePerTicketCents = toCents(r[pi]!, priceMode);
    const id = (idi !== -1 && r[idi]?.trim()) || `bid-${String(idx + 1).padStart(3, "0")}`;
    return {
      id,
      userId: `user-${id}`,
      showId: "sim-show",
      groupSize,
      pricePerTicketCents,
      rankKey: computeRankKey(pricePerTicketCents, groupSize),
      submittedAt: new Date(base + idx * 1000), // CSV order = submission order for tie-breaks
      tierPreference: parseTierPref(ti !== -1 ? r[ti] : undefined),
    };
  });

  const result = allocate(venue, offers, CONFIG);
  const placedIds = new Set(result.assignments.map((a) => a.offerId));

  console.log(`\n  GAE trial — ${csvPath}`);
  console.log(`  venue: ${venue.venueId} (${totalCap} available seats) · price read as ${priceMode}\n`);

  console.log(`  Bids (${offers.length}), ranked best→worst:`);
  for (const o of sortRankedOffers(offers)) {
    const tier = o.tierPreference.type === "any" ? "any" : `${o.tierPreference.type}:${(o.tierPreference as { tier: string }).tier}`;
    console.log(`    ${placedIds.has(o.id) ? "✓" : "✗"} ${o.id.padEnd(12)} ${String(o.groupSize).padStart(2)}× @ ${fmtUsd(o.pricePerTicketCents).padStart(9)}  [${tier}]`);
  }

  console.log(`\n  Seat map (· empty · ▓ held):`);
  for (const row of activeRows) {
    const occ = new Map<number, string>();
    for (const a of result.assignments) {
      if (a.venueRowId === row.id) occ.set(a.positionIndex, a.offerId);
    }
    const heldSet = new Set(row.holds);
    const tokens = row.seatNumbers.map((sn, i) =>
      heldSet.has(sn) ? "▓" : (occ.get(i) ?? "·"),
    );
    const w = Math.max(2, ...tokens.map((t) => t.length));
    const strip = tokens.map((t) => t.padEnd(w)).join(" ");
    const label = `Row ${row.rowName} (${row.tier ?? "—"}, ${row.lean}${row.isGa ? "/GA" : ""})`;
    console.log(`    ${label.padEnd(28)} ${strip}`);
  }

  if (result.unplaced.length > 0) {
    console.log(`\n  Unplaced:`);
    for (const u of result.unplaced) console.log(`    ✗ ${u.offerId.padEnd(12)} ${u.reason}`);
  }

  const s = result.stats;
  console.log(`\n  Stats:`);
  console.log(`    fill rate:       ${(s.fillRate * 100).toFixed(1)}%  (${s.placedSeats}/${totalCap} seats)`);
  console.log(`    offers placed:   ${s.placedOffers}/${s.totalOffers}`);
  console.log(`    offers unplaced: ${s.unplacedOffers}`);
  console.log(`    orphan seats:    ${s.orphanSeats}`);
  console.log(`    unfilled seats:  ${s.unfilledSeats}\n`);
}

main();
