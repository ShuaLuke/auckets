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

// Render "1, 2, 27, 28" — no compaction of consecutive runs. The
// prototype mock shows "1-4" for a contiguous range; doing that
// faithfully needs sort + range detection. Until the Add-hold
// dialog ships we keep the simpler comma list, which is also more
// honest about discontiguous holds.
function formatSeatNumbers(seatNumbers: readonly string[]): string {
  return seatNumbers.join(", ");
}

function buildSeatDescription(
  hold: Hold,
  rowName: (id: string) => string,
): string {
  const base = `Row ${rowName(hold.venueRowId)} · seats ${formatSeatNumbers(hold.seatNumbers)}`;
  return hold.notes ? `${base} (${hold.notes})` : base;
}

export function presentHolds(
  rows: readonly Hold[],
  architecture: Pick<VenueArchitecture, "rows"> | null,
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
      mutable: hold.kind === "artist",
      seatCount,
      seatDescription: buildSeatDescription(hold, lookupRow),
    };
  });
  return { rows: out, total };
}
