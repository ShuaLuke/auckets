// Offer pools from CSV text. Column names are matched case-insensitively
// with the aliases below, so Cope's "Full Offer Pool v4" sheet exported to
// CSV (OfferID, PricePerTicket, GroupSize, TimestampOrder…) and a bare
// "size,price" sheet both load. Prices are dollars unless told otherwise;
// converted to integer cents at this boundary and never floats after.

import { computeRankKey } from "@/lib/gae/rankkey";
import type { RankedOffer, TierPreference } from "@/lib/gae/types";

import type { OfferParitySummary } from "./types";
import { SimInputError } from "./venue";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const COLUMN_ALIASES: Record<string, string[]> = {
  groupSize: ["groupsize", "size", "party", "partysize", "qty", "quantity", "seats", "tickets"],
  price: ["price", "bid", "priceperticket", "priceperticketcents", "offer", "amount", "ppt"],
  tier: ["tier", "tierpref", "tierpreference", "preference"],
  id: ["id", "offerid", "bidid"],
  order: ["timestamporder", "timestamp", "submittedat", "order", "arrival"],
};

function findColumn(headers: string[], key: string): number {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[\s_]/g, ""));
  for (const alias of COLUMN_ALIASES[key]!) {
    const idx = norm.indexOf(alias);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function toCents(raw: string, mode: "dollars" | "cents"): number {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || Number.isNaN(Number(cleaned))) throw new SimInputError(`bad price "${raw}"`);
  if (mode === "cents") return Math.round(Number(cleaned));
  const [dollars, frac = ""] = cleaned.split(".");
  return Number(dollars) * 100 + Number((frac + "00").slice(0, 2));
}

// "premium" → specific; "premium-" → this_or_worse; "premium+" → this_or_better;
// "any" / "*" / blank → any. Also accepts "this_or_worse:premium" forms.
export function parseTierPref(raw: string | undefined): TierPreference {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t || ["any", "*", "either"].includes(t)) return { type: "any" };
  const m = /^(specific|this_or_better|this_or_worse):(.+)$/.exec(t);
  if (m) return { type: m[1] as "specific" | "this_or_better" | "this_or_worse", tier: m[2]! };
  if (t.endsWith("+")) return { type: "this_or_better", tier: t.slice(0, -1) };
  if (t.endsWith("-")) return { type: "this_or_worse", tier: t.slice(0, -1) };
  return { type: "specific", tier: t };
}

export function formatTierPref(p: TierPreference): string {
  switch (p.type) {
    case "any":
      return "any";
    case "specific":
      return p.tier;
    case "this_or_worse":
      return `${p.tier}-`;
    case "this_or_better":
      return `${p.tier}+`;
  }
}

export const SUBMITTED_BASE_MS = Date.UTC(2026, 0, 1);

export function offersFromCsv(
  text: string,
  opts: { priceMode?: "dollars" | "cents"; label?: string } = {},
): RankedOffer[] {
  const label = opts.label ?? "pool";
  const priceMode = opts.priceMode ?? "dollars";
  const rows = parseCsv(text);
  if (rows.length < 2) throw new SimInputError(`${label}: CSV has no data rows`);
  const headers = rows[0]!;
  const gi = findColumn(headers, "groupSize");
  const pi = findColumn(headers, "price");
  const ti = findColumn(headers, "tier");
  const idi = findColumn(headers, "id");
  const oi = findColumn(headers, "order");
  if (gi === -1 || pi === -1) {
    throw new SimInputError(
      `${label}: need a group-size column and a price column. Saw: ${headers.join(", ")}`,
    );
  }
  const seen = new Set<string>();
  return rows.slice(1).map((r, idx) => {
    const line = idx + 2;
    const groupSize = Math.round(Number(r[gi]?.trim()));
    if (!Number.isFinite(groupSize) || groupSize < 1) throw new SimInputError(`${label} line ${line}: bad group size "${r[gi]}"`);
    const pricePerTicketCents = toCents(r[pi] ?? "", priceMode);
    const id = (idi !== -1 && r[idi]?.trim()) || `bid-${String(idx + 1).padStart(4, "0")}`;
    if (seen.has(id)) throw new SimInputError(`${label} line ${line}: duplicate offer id "${id}"`);
    seen.add(id);
    const order = oi !== -1 && r[oi]?.trim() ? Number(r[oi]) : idx + 1;
    if (!Number.isFinite(order)) throw new SimInputError(`${label} line ${line}: bad timestamp/order "${r[oi]}"`);
    return {
      id,
      userId: `user-${id}`,
      showId: "sim-show",
      groupSize,
      pricePerTicketCents,
      rankKey: computeRankKey(pricePerTicketCents, groupSize),
      submittedAt: new Date(SUBMITTED_BASE_MS + order * 1000),
      tierPreference: parseTierPref(ti !== -1 ? r[ti] : undefined),
    };
  });
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

// Cope's "Offer Pool Summary": even/odd pressure, tickets by group size.
export function offerParitySummary(offers: RankedOffer[], availableSeats: number): OfferParitySummary {
  const byGroupSize: OfferParitySummary["byGroupSize"] = {};
  const byPreference: OfferParitySummary["byPreference"] = { specific: 0, this_or_worse: 0, this_or_better: 0, any: 0 };
  let tickets = 0;
  let evenOffers = 0;
  let oddOffers = 0;
  let evenTickets = 0;
  let oddTickets = 0;
  for (const o of offers) {
    tickets += o.groupSize;
    const g = (byGroupSize[o.groupSize] ??= { offers: 0, tickets: 0, shareOfOffersPct: 0, shareOfTicketsPct: 0 });
    g.offers += 1;
    g.tickets += o.groupSize;
    if (o.groupSize % 2 === 0) {
      evenOffers += 1;
      evenTickets += o.groupSize;
    } else {
      oddOffers += 1;
      oddTickets += o.groupSize;
    }
    byPreference[o.tierPreference.type] += 1;
  }
  for (const g of Object.values(byGroupSize)) {
    g.shareOfOffersPct = offers.length === 0 ? 0 : (100 * g.offers) / offers.length;
    g.shareOfTicketsPct = tickets === 0 ? 0 : (100 * g.tickets) / tickets;
  }
  const prices = offers.map((o) => o.pricePerTicketCents);
  return {
    offers: offers.length,
    ticketsRequested: tickets,
    availableSeats,
    demandMultiple: availableSeats === 0 ? 0 : tickets / availableSeats,
    evenOffers,
    oddOffers,
    evenTickets,
    oddTickets,
    byGroupSize,
    byPreference,
    priceMinCents: prices.length ? Math.min(...prices) : 0,
    priceMaxCents: prices.length ? Math.max(...prices) : 0,
    priceMedianCents: median(prices),
  };
}
