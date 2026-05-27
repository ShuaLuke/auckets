// Presenter for the ShowAdmin "Holds — by source" card. Mirrors
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 271-303 — one row
// per hold with the source as a tag, seat description, count, and an
// edit affordance gated on whether the hold is artist-mutable.
//
// Seat description: "Row F · seats 1, 2, 27, 28" — combines the row
// name (looked up from the venue architecture) with the seat-number
// array. Notes append in parens when present ("Row BB · seats 1-4
// (sound desk)").

import type { Hold, VenueArchitecture } from "@/lib/db/repositories";
import type { VenueRow as GaeVenueRow } from "@/lib/gae/types";

export type HoldRowView = {
  id: string;
  source: string;
  // 'venue' | 'artist' — drives the read-only-vs-edit affordance.
  kind: string;
  // True when the hold belongs to a row the artist controls. When
  // false, the UI renders a "Read-only" chip instead of a trash icon.
  mutable: boolean;
  seatCount: number;
  // Formatted seat description, e.g. "Row F · seats 1, 2, 27, 28
  // (camera platform)".
  seatDescription: string;
};

export type HoldsView = {
  rows: readonly HoldRowView[];
  total: number;
};

function rowNameLookup(
  architecture: Pick<VenueArchitecture, "rows"> | null,
): (id: string) => string {
  if (!architecture) return (id) => id;
  const archRows = architecture.rows as readonly GaeVenueRow[];
  const byId = new Map<string, string>();
  for (const r of archRows) byId.set(r.id, r.rowName);
  return (id) => byId.get(id) ?? id;
}

// Render "1-4, 7, 9-12" — sort numerically, fold consecutive runs.
// Non-numeric seat labels (e.g. "1A") get passed through verbatim
// rather than risking weird ordering; mixing numeric and non-numeric
// labels is rare in practice but the fallback keeps the output
// readable instead of throwing.
export function formatSeatNumbers(seatNumbers: readonly string[]): string {
  // Empty input shouldn't reach this function (createHold requires
  // at least one seat) but stay tidy if it does.
  if (seatNumbers.length === 0) return "";

  // Mixed-mode: if any label isn't a clean non-negative integer, fall
  // back to a sorted comma list to avoid lying about a range.
  const numerics = seatNumbers.map((s) => {
    const n = Number(s);
    return Number.isInteger(n) && n >= 0 && String(n) === s ? n : null;
  });
  const allNumeric = numerics.every((n): n is number => n !== null);
  if (!allNumeric) {
    return [...seatNumbers].sort().join(", ");
  }

  const sorted = (numerics as number[]).slice().sort((a, b) => a - b);
  const parts: string[] = [];
  let runStart = sorted[0]!;
  let runEnd = runStart;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === runEnd + 1) {
      runEnd = n;
      continue;
    }
    parts.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`);
    runStart = n;
    runEnd = n;
  }
  parts.push(runStart === runEnd ? `${runStart}` : `${runStart}-${runEnd}`);
  return parts.join(", ");
}

function buildSeatDescription(
  hold: Hold,
  rowName: (id: string) => string,
): string {
  const base = `Row ${rowName(hold.venueRowId)} · seats ${formatSeatNumbers(hold.seatNumbers)}`;
  return hold.notes ? `${base} (${hold.notes})` : base;
}

// Mutability is the artist-vs-venue boundary by default. AUCKETS_ADMIN
// can edit anything; pass viewerIsAdmin=true to flip every row to
// mutable. The artist (non-admin) can only touch artist-kind rows;
// venue-kind is read-only to them. Same posture the ShowAdmin UI
// already implies — admin sees the trash icon on every row, artist
// sees it only on artist-kind rows.
export function presentHolds(
  rows: readonly Hold[],
  architecture: Pick<VenueArchitecture, "rows"> | null,
  viewerIsAdmin: boolean = false,
): HoldsView {
  const lookupRow = rowNameLookup(architecture);
  let total = 0;
  const out: HoldRowView[] = rows.map((hold) => {
    const seatCount = hold.seatNumbers.length;
    total += seatCount;
    return {
      id: hold.id,
      source: hold.source,
      kind: hold.kind,
      mutable: viewerIsAdmin || hold.kind === "artist",
      seatCount,
      seatDescription: buildSeatDescription(hold, lookupRow),
    };
  });
  return { rows: out, total };
}
