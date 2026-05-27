// Presenter for the admin inbox at /admin/requests. Takes the joined
// repo shape (request row + show/artist/venue/filer email) and adds the
// display-only derived fields the page needs — kind label, formatted
// timestamps, a one-line show context string.
//
// Per ADR-0013, the admin inbox is where AUCKETS ops execute or deny
// the requests artists file via the ShowAdmin dialog. This view shape
// is read-only; the row's action affordances (execute / deny) live in
// the client component and call PATCH /api/artist-requests/[id].

import type {
  ArtistRequestInboxRow,
  ArtistRequestKind,
  ArtistRequestStatus,
} from "@/lib/db/repositories";

import { formatTimeAgo } from "./activity";
import { DEFAULT_TZ, formatDateLong } from "./format";

// Mirrors the four KIND_OPTIONS the RequestActionButton dialog
// surfaces. Kept inline here rather than imported to keep the
// presenter dependency-free and not couple the admin view to a
// client component's options table — these labels are intentionally
// the ops-side phrasing, which can drift from the artist-side prompt
// over time.
const KIND_LABELS: Record<ArtistRequestKind, string> = {
  comp: "Comp guests",
  override: "Override placement",
  pause: "Pause offers",
  end_early: "End offer window early",
};

export type ArtistRequestInboxView = {
  id: string;
  showId: string;
  artistId: string;
  kind: ArtistRequestKind;
  kindLabel: string;
  status: ArtistRequestStatus;
  details: string;
  // Header for the row: "Citizen Cope · Lincoln Theatre · Sat · Jun 15 · 7pm".
  showContext: string;
  artistName: string;
  filerEmail: string;
  // "12m ago" — short relative for the inbox scroll.
  filedTimeAgo: string;
  // "Mon · May 27 · 11am" — long form for the expanded card.
  filedDisplay: string;
  // Populated only on executed/denied rows. Drives the "Executed by
  // ops@auckets.com 12m ago" footer in the row.
  executor: {
    email: string;
    timeAgo: string;
    display: string;
    notes: string | null;
  } | null;
};

function statusOf(raw: string): ArtistRequestStatus {
  // The DB column is TEXT; the union is enforced at the route boundary
  // for writes, so any row that lands in the inbox has one of these
  // three values. Cast at the presenter layer to keep the view shape
  // tight.
  if (raw === "open" || raw === "executed" || raw === "denied") return raw;
  // Shouldn't happen — surface loudly via 'open' so the row still
  // renders. If we add new statuses later, the route-layer Zod will
  // catch them; presenter just defends against drift.
  return "open";
}

function kindOf(raw: string): ArtistRequestKind {
  if (raw === "comp" || raw === "override" || raw === "pause" || raw === "end_early") {
    return raw;
  }
  // Same drift-defense as statusOf. The displayed kindLabel below
  // falls back to the raw kind so even an unknown kind renders
  // something readable.
  return raw as ArtistRequestKind;
}

export function presentArtistRequestInboxRow(
  row: ArtistRequestInboxRow,
  // Email of the executor when the row has been actioned. Pulled in
  // the page layer (not the join) because we don't want the inbox
  // query to grow a second users join for a value we only need on a
  // subset of rows — the page batches a single lookup for the unique
  // executor IDs in the result and passes the map in here. May be
  // null if the lookup hasn't populated yet or the executor is a
  // user that no longer exists.
  executorEmail: string | null,
  now: Date,
  tz: string = DEFAULT_TZ,
): ArtistRequestInboxView {
  const kind = kindOf(row.kind);
  const status = statusOf(row.status);
  const cityPart = row.showVenueCity ? `${row.showVenueCity} · ` : "";
  const showContext = `${row.artistName} · ${cityPart}${row.showVenueName} · ${formatDateLong(row.showDoorsAt, tz)}`;

  const executor =
    row.executedAt && row.executedBy
      ? {
          email: executorEmail ?? row.executedBy,
          timeAgo: formatTimeAgo(row.executedAt, now),
          display: formatDateLong(row.executedAt, tz),
          notes: row.notes,
        }
      : null;

  return {
    id: row.id,
    showId: row.showId,
    artistId: row.artistId,
    kind,
    kindLabel: KIND_LABELS[kind] ?? row.kind,
    status,
    details: row.details,
    showContext,
    artistName: row.artistName,
    filerEmail: row.filerEmail,
    filedTimeAgo: formatTimeAgo(row.createdAt, now),
    filedDisplay: formatDateLong(row.createdAt, tz),
    executor,
  };
}
