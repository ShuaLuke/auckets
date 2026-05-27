// Presenter for the offer-revision history. Pairs adjacent revision
// rows to derive diffs ("$30 → $40", "size 4 → 6"), and stamps the
// FIRST row as "Submitted" since that's the initial state.
//
// Walking input: oldest-first. The first row (closest to submission)
// has no prior to compare against — render as "Submitted with $X × N
// at tierLabel". Subsequent rows render diffs against the immediately
// prior row.

import { formatCents } from "@/lib/money";

import type { OfferRevision } from "@/lib/db/repositories";

import { DEFAULT_TZ, formatDateLong } from "./format";

// What we extract from the jsonb snapshot. Mirrors what the write path
// captures in upsertOfferForUser. Missing fields are treated as "not
// present at this revision" so older snapshots with fewer fields
// (added later) don't crash the render.
type SnapshotShape = {
  groupSize?: unknown;
  pricePerTicketCents?: unknown;
  tierPreference?: unknown;
  preferredTier?: unknown;
  autoBidEnabled?: unknown;
  autoBidCapCents?: unknown;
};

function readGroupSize(snapshot: unknown): number | null {
  const s = snapshot as SnapshotShape;
  return typeof s.groupSize === "number" ? s.groupSize : null;
}
function readPriceCents(snapshot: unknown): number | null {
  const s = snapshot as SnapshotShape;
  return typeof s.pricePerTicketCents === "number"
    ? s.pricePerTicketCents
    : null;
}
function readTierPref(snapshot: unknown): string | null {
  const s = snapshot as SnapshotShape;
  return typeof s.tierPreference === "string" ? s.tierPreference : null;
}
function readPreferredTier(snapshot: unknown): string | null {
  const s = snapshot as SnapshotShape;
  return typeof s.preferredTier === "string" ? s.preferredTier : null;
}

function tierLabelFor(
  tierPreference: string | null,
  preferredTier: string | null,
): string {
  if (tierPreference === "specific" && preferredTier) {
    return `${preferredTier} only`;
  }
  if (tierPreference === "this_or_worse" && preferredTier) {
    return `${preferredTier} or below`;
  }
  if (tierPreference === "this_or_better" && preferredTier) {
    return `${preferredTier} or above`;
  }
  return "anywhere";
}

export type RevisionEntry = {
  id: string;
  kind: "submitted" | "revised";
  recordedDisplay: string;
  // One-line summary like "$30.00 × 4 · premium only" or
  // "$30.00 → $40.00" or "size 4 → 6 · price unchanged".
  summary: string;
  // Granular diff bullets — empty for the "submitted" entry. Useful when
  // the row's summary needs to fit on one line but multiple things
  // changed.
  changes: readonly string[];
};

export type OfferHistoryView = {
  entries: readonly RevisionEntry[];
};

function diffLines(
  prior: OfferRevision,
  next: OfferRevision,
): string[] {
  const out: string[] = [];
  const pPrice = readPriceCents(prior.snapshot);
  const nPrice = readPriceCents(next.snapshot);
  if (pPrice !== nPrice && nPrice !== null) {
    out.push(
      `${pPrice === null ? "—" : formatCents(pPrice)} → ${formatCents(nPrice)}`,
    );
  }
  const pSize = readGroupSize(prior.snapshot);
  const nSize = readGroupSize(next.snapshot);
  if (pSize !== nSize && nSize !== null) {
    out.push(`size ${pSize ?? "?"} → ${nSize}`);
  }
  const pTier = tierLabelFor(
    readTierPref(prior.snapshot),
    readPreferredTier(prior.snapshot),
  );
  const nTier = tierLabelFor(
    readTierPref(next.snapshot),
    readPreferredTier(next.snapshot),
  );
  if (pTier !== nTier) {
    out.push(`tier ${pTier} → ${nTier}`);
  }
  return out;
}

function submittedSummary(snapshot: unknown): string {
  const price = readPriceCents(snapshot);
  const size = readGroupSize(snapshot);
  const tier = tierLabelFor(
    readTierPref(snapshot),
    readPreferredTier(snapshot),
  );
  const priceText = price === null ? "—" : formatCents(price);
  const sizeText = size === null ? "?" : size;
  return `${priceText} × ${sizeText} · ${tier}`;
}

export function presentOfferHistory(
  rows: readonly OfferRevision[],
  tz: string = DEFAULT_TZ,
): OfferHistoryView {
  const entries: RevisionEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (i === 0) {
      entries.push({
        id: row.id,
        kind: "submitted",
        recordedDisplay: formatDateLong(row.recordedAt, tz),
        summary: submittedSummary(row.snapshot),
        changes: [],
      });
      continue;
    }
    const prior = rows[i - 1];
    if (!prior) continue;
    const changes = diffLines(prior, row);
    entries.push({
      id: row.id,
      kind: "revised",
      recordedDisplay: formatDateLong(row.recordedAt, tz),
      summary:
        changes[0] ??
        // No effective change in the fields we render — possible if a
        // field we don't surface here was the only thing that moved
        // (autoBidCap, privateThreshold, etc.).
        "Updated (no visible field changes)",
      changes,
    });
  }
  return { entries };
}
