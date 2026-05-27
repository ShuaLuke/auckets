// Presenter for the ShowAdmin Recent activity feed. Two sources:
//
//   1. offers — submitted_at + revised_at yield "new offer" / "revision"
//      events. Revision events show a "$X → $Y" diff when the offer's
//      full revision history (offer_revisions table) is provided via the
//      optional `offerHistoryByOfferId` map. Without that map the feed
//      falls back to "now $Y × N" (no regression — just less context).
//
//   2. allocation_logs — preview-mode log rows for PLACED / SKIPPED /
//      ORPHAN_DETECTED / WATERFALLED actions. One log row → one
//      ActivityEvent.
//
// Both streams are merged, sorted by `at` DESC, and truncated to
// `limit` (default 10). The cap matches the prototype's ~7-row Card
// (design/ui_kits/auckets/screens/ShowAdmin.jsx).

import { formatCents } from "@/lib/money";

import type {
  AllocationLog,
  Offer,
  OfferRevision,
  VenueArchitecture,
} from "@/lib/db/repositories";
import type { VenueRow as GaeVenueRow } from "@/lib/gae/types";

const DEFAULT_LIMIT = 10;

// Composer-matching labels keep the activity feed's tier copy aligned
// with what the fan picked. Same mapping as src/lib/presenters/bids.ts
// — kept inline rather than imported to avoid coupling the two.
function tierLabelFor(
  tierPreference: string,
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

// Short relative-time formatter for activity rows. Mirrors the
// prototype's "2m ago" / "1h ago" / "3d ago" style. For very recent
// events (< 1 minute) we say "just now" rather than "0m ago".
export function formatTimeAgo(at: Date, now: Date): string {
  const diffMs = now.getTime() - at.getTime();
  if (diffMs < 60_000) return "just now";
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m ago`;
  const totalHours = Math.floor(diffMs / (60 * 60_000));
  if (totalHours < 24) return `${totalHours}h ago`;
  const totalDays = Math.floor(diffMs / (24 * 60 * 60_000));
  return `${totalDays}d ago`;
}

export type ActivityEvent = {
  kind: "new" | "revised" | "placed" | "skipped" | "orphan" | "waterfall";
  at: Date;
  timeAgo: string;
  // Last 4 of the offer ID for visual identity, matching the prototype's
  // "offer_8f3a" treatment. The full ID would dominate the row. May be
  // empty for events that aren't tied to a specific offer (e.g.
  // an orphan-detected row for seats that no offer claimed).
  offerTag: string;
  message: string;
};

function offerTagFor(id: string): string {
  // UUID is 36 chars with dashes; the trailing 4 are unique enough
  // for at-a-glance identification.
  return `offer_${id.slice(-4)}`;
}

function newOfferMessage(offer: Offer): string {
  const price = formatCents(offer.pricePerTicketCents);
  const tier = tierLabelFor(offer.tierPreference, offer.preferredTier);
  return `New offer · ${price} × ${offer.groupSize} · ${tier}`;
}

// Safely pull { priceCents, groupSize } out of a jsonb snapshot.
// The snapshot is typed `unknown` in Drizzle (jsonb has no static
// shape); this guard is the boundary where we narrow it.
function snapshotFields(
  snapshot: unknown,
): { priceCents: number; groupSize: number } | null {
  if (
    snapshot !== null &&
    typeof snapshot === "object" &&
    "pricePerTicketCents" in snapshot &&
    "groupSize" in snapshot &&
    typeof (snapshot as Record<string, unknown>).pricePerTicketCents === "number" &&
    typeof (snapshot as Record<string, unknown>).groupSize === "number"
  ) {
    return {
      priceCents: (snapshot as { pricePerTicketCents: number }).pricePerTicketCents,
      groupSize: (snapshot as { groupSize: number }).groupSize,
    };
  }
  return null;
}

function revisedMessage(offer: Offer, history: readonly OfferRevision[]): string {
  const tag = offerTagFor(offer.id);
  const toPrice = formatCents(offer.pricePerTicketCents);
  const toGroup = offer.groupSize;

  // history is oldest-first (ORDER BY recorded_at ASC). The last row is
  // the current state; the second-to-last is the state immediately before
  // this revision. We need ≥2 rows to compute a diff.
  if (history.length >= 2) {
    const prevSnap = snapshotFields(history[history.length - 2]?.snapshot);
    if (prevSnap !== null) {
      if (prevSnap.priceCents !== offer.pricePerTicketCents) {
        // Price changed — most prominent signal; show price diff.
        const fromPrice = formatCents(prevSnap.priceCents);
        return `Revision · ${tag} · ${fromPrice} → ${toPrice} × ${toGroup}`;
      }
      if (prevSnap.groupSize !== offer.groupSize) {
        // Only group size changed (tier/other edit). Show group diff.
        return `Revision · ${tag} · ${toPrice} × ${prevSnap.groupSize} → ${toGroup}`;
      }
    }
  }

  // Fallback: no history loaded yet, or snapshot fields not parseable,
  // or both price and group are identical (shouldn't happen but defensive).
  return `Revision · ${tag} · now ${toPrice} × ${toGroup}`;
}

// Map venue_row_id (the GAE-defined slug stored on logs/assignments)
// to the display row name (e.g. "A", "AA"). When the architecture is
// missing or the row id isn't found, fall back to the raw id so the
// row at least identifies something.
function rowNameLookup(
  architecture: Pick<VenueArchitecture, "rows"> | null,
): (rowId: string | null) => string | null {
  if (!architecture) return (id) => id;
  const archRows = architecture.rows as readonly GaeVenueRow[];
  const byId = new Map<string, string>();
  for (const r of archRows) byId.set(r.id, r.rowName);
  return (id) => (id ? (byId.get(id) ?? id) : null);
}

function logEventFor(
  log: AllocationLog,
  rowName: (id: string | null) => string | null,
  now: Date,
): ActivityEvent | null {
  const row = rowName(log.venueRowId);
  const tag = log.offerId ? offerTagFor(log.offerId) : "";
  const at = log.createdAt;
  switch (log.action) {
    case "PLACED": {
      const where = row ? ` · Row ${row}` : "";
      return {
        kind: "placed",
        at,
        timeAgo: formatTimeAgo(at, now),
        offerTag: tag,
        message: `Placed · ${tag}${where}`,
      };
    }
    case "SKIPPED":
      return {
        kind: "skipped",
        at,
        timeAgo: formatTimeAgo(at, now),
        offerTag: tag,
        message: `Skipped · ${tag} · ${log.reason}`,
      };
    case "ORPHAN_DETECTED": {
      const where = row ? `Row ${row}` : "Row ?";
      return {
        kind: "orphan",
        at,
        timeAgo: formatTimeAgo(at, now),
        offerTag: "",
        message: `Orphan · ${where} · ${log.reason}`,
      };
    }
    case "WATERFALLED": {
      const where = row ? ` · Row ${row}` : "";
      return {
        kind: "waterfall",
        at,
        timeAgo: formatTimeAgo(at, now),
        offerTag: tag,
        message: `Waterfalled · ${tag}${where} · ${log.reason}`,
      };
    }
    default:
      // RUN_START / RUN_END / FIT_RESOLVED / MANUAL_OVERRIDE are not
      // surfaced today. The repo layer filters these out at the query
      // boundary; this branch only fires if a new action type sneaks
      // through.
      return null;
  }
}

export function presentRecentActivity(
  offerRows: readonly Offer[],
  logRows: readonly AllocationLog[],
  architecture: Pick<VenueArchitecture, "rows"> | null,
  now: Date,
  limit: number = DEFAULT_LIMIT,
  // Optional: full revision history for the offers in `offerRows`. When
  // present, revision events show a "$X → $Y" diff; when absent (or when
  // a given offer isn't in the map), they fall back to "now $Y × N".
  // Callers that don't need the diff (tests, non-ShowAdmin surfaces) can
  // omit this argument.
  offerHistoryByOfferId: ReadonlyMap<string, readonly OfferRevision[]> = new Map(),
): ActivityEvent[] {
  const events: ActivityEvent[] = [];
  for (const offer of offerRows) {
    events.push({
      kind: "new",
      at: offer.submittedAt,
      timeAgo: formatTimeAgo(offer.submittedAt, now),
      offerTag: offerTagFor(offer.id),
      message: newOfferMessage(offer),
    });
    if (offer.revisedAt) {
      const history = offerHistoryByOfferId.get(offer.id) ?? [];
      events.push({
        kind: "revised",
        at: offer.revisedAt,
        timeAgo: formatTimeAgo(offer.revisedAt, now),
        offerTag: offerTagFor(offer.id),
        message: revisedMessage(offer, history),
      });
    }
  }
  const lookupRow = rowNameLookup(architecture);
  for (const log of logRows) {
    const ev = logEventFor(log, lookupRow, now);
    if (ev) events.push(ev);
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());
  return events.slice(0, limit);
}
