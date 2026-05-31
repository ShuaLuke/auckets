// Read-path queries for the shows table.
//
// Repositories return raw DB shapes — no formatting, no presenter-derived
// fields (dateLong, statusLabel, etc). Timestamps are Date, money is integer
// cents, JSONB columns stay as the raw stored value. Display formatting lives
// in src/lib/presenters/ (lands in slice 3); the prototype shapes in
// design/ui_kits/auckets/screens/*.jsx are the presenter contract, not the
// repository contract.

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import type { Db } from "@/lib/db";
import type { VenueRow } from "@/lib/gae/types";
import {
  artists,
  shows,
  venueArchitectures,
  venues,
} from "../../../../drizzle/schema";

type Show = typeof shows.$inferSelect;
type Artist = typeof artists.$inferSelect;
type Venue = typeof venues.$inferSelect;
type VenueArchitectureRow = typeof venueArchitectures.$inferSelect;

// venue_architectures.rows is jsonb; Drizzle types it as unknown. The
// architecture JSONB is camelCase VenueRow[] (matches src/lib/gae/types.ts,
// matches the seed). Narrow only this column — the GAE consumes it directly,
// and a downstream cast at every call site would be noise. tier_floors_cents,
// active_row_ids, show_holds stay unknown per "raw JSONB" contract.
export type VenueArchitecture = Omit<VenueArchitectureRow, "rows"> & {
  rows: VenueRow[];
};

export type ShowWithRelations = Show & {
  artist: Artist;
  venue: Venue;
  venueArchitecture: VenueArchitecture;
};

export type ShowSummary = {
  id: Show["id"];
  artistId: Show["artistId"];
  venueId: Show["venueId"];
  venueArchitectureId: Show["venueArchitectureId"];
  status: Show["status"];
  doorsAt: Show["doorsAt"];
  offerWindowOpensAt: Show["offerWindowOpensAt"];
  bindingAllocationAt: Show["bindingAllocationAt"];
  pausedAt: Show["pausedAt"];
  // Per-show subset of architecture rows (NEW-4 partial-venue
  // activation). Needed by the artist-dashboard capacity computation —
  // a 624-seat venue can host a 280-seat show. Drizzle stores this as
  // jsonb (unknown); we narrow to string[] at the projection boundary.
  activeRowIds: string[];
  artistName: Artist["name"];
  venueName: Venue["name"];
  venueCity: Venue["city"];
};

export async function getShowById(
  db: Db,
  showId: string,
): Promise<ShowWithRelations | null> {
  const rows = await db
    .select()
    .from(shows)
    .innerJoin(artists, eq(shows.artistId, artists.id))
    .innerJoin(venues, eq(shows.venueId, venues.id))
    .innerJoin(
      venueArchitectures,
      eq(shows.venueArchitectureId, venueArchitectures.id),
    )
    .where(eq(shows.id, showId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row.shows,
    artist: row.artists,
    venue: row.venues,
    venueArchitecture: {
      ...row.venue_architectures,
      rows: row.venue_architectures.rows as VenueRow[],
    },
  };
}

const SHOW_SUMMARY_SELECTION = {
  id: shows.id,
  artistId: shows.artistId,
  venueId: shows.venueId,
  venueArchitectureId: shows.venueArchitectureId,
  status: shows.status,
  doorsAt: shows.doorsAt,
  offerWindowOpensAt: shows.offerWindowOpensAt,
  bindingAllocationAt: shows.bindingAllocationAt,
  pausedAt: shows.pausedAt,
  activeRowIds: shows.activeRowIds,
  artistName: artists.name,
  venueName: venues.name,
  venueCity: venues.city,
} as const;

// shows.activeRowIds is jsonb (unknown). The schema stores it as a
// string[] (NEW-4). Cast at the projection boundary so callers see the
// narrow type.
function narrowSummary(row: {
  activeRowIds: unknown;
  [k: string]: unknown;
}): ShowSummary {
  return { ...row, activeRowIds: row.activeRowIds as string[] } as ShowSummary;
}

export async function listOpenShows(db: Db): Promise<ShowSummary[]> {
  const rows = await db
    .select(SHOW_SUMMARY_SELECTION)
    .from(shows)
    .innerJoin(artists, eq(shows.artistId, artists.id))
    .innerJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.status, "open"))
    .orderBy(shows.doorsAt);
  return rows.map(narrowSummary);
}

// Statuses a show can be auto-bound from. Mirrors run-binding's
// BINDING_ELIGIBLE_STATUSES. 'paused' is excluded on purpose — a halt was
// requested (ADR-0013), so ops decides whether to bind, not the scheduler.
const BINDING_DUE_STATUSES = ["open", "closed"] as const;

// Shows whose announced binding checkpoint (binding_allocation_at) has arrived
// but that haven't been bound yet — the work list for the scheduled-binding
// cron. Returns ids only; the sweep loads + binds each via runBindingAllocation
// (which re-checks eligibility, so a show that flips state between this query
// and the call is handled safely). Backed by shows_binding_at_idx.
export async function listShowIdsDueForBinding(
  db: Db,
  now: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(
      and(
        lte(shows.bindingAllocationAt, now),
        inArray(shows.status, [...BINDING_DUE_STATUSES]),
      ),
    )
    .orderBy(shows.bindingAllocationAt);
  return rows.map((r) => r.id);
}

// Shows ready for ticket issuance: bound ('allocated') and within the T-48h
// issuance horizon (doors within `horizon`). Tickets issue T-48h before doors
// per TECHNICAL_INTEGRATION.md; the issuance sweep passes now + 48h as the
// horizon. Returns ids only — the sweep loads each show's charged seats.
export async function listShowIdsDueForTicketIssuance(
  db: Db,
  horizon: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(and(eq(shows.status, "allocated"), lte(shows.doorsAt, horizon)))
    .orderBy(shows.doorsAt);
  return rows.map((r) => r.id);
}

// Shows still 'open' whose binding checkpoint falls in [from, to] — the work
// list for the allocation-imminent reminder cron. Only 'open' shows qualify:
// the reminder's whole point is "revise upward before it's too late," which is
// only possible while offers are open. Returns ids; the sweep loads each via
// getShowById + its pool offers. Backed by shows_binding_at_idx.
export async function listShowIdsWithBindingBetween(
  db: Db,
  from: Date,
  to: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: shows.id })
    .from(shows)
    .where(
      and(
        eq(shows.status, "open"),
        gte(shows.bindingAllocationAt, from),
        lte(shows.bindingAllocationAt, to),
      ),
    )
    .orderBy(shows.bindingAllocationAt);
  return rows.map((r) => r.id);
}

export async function listShowsForArtist(
  db: Db,
  artistId: string,
): Promise<ShowSummary[]> {
  const rows = await db
    .select(SHOW_SUMMARY_SELECTION)
    .from(shows)
    .innerJoin(artists, eq(shows.artistId, artists.id))
    .innerJoin(venues, eq(shows.venueId, venues.id))
    .where(eq(shows.artistId, artistId))
    .orderBy(shows.doorsAt);
  return rows.map(narrowSummary);
}

// Every show across every artist, no status filter — the admin
// command-center spine (`/admin`). Unlike listOpenShows / listShowsFor-
// Artist this is deliberately unscoped: ops needs draft, paused,
// allocated and complete shows in one view. Ordered by doorsAt so the
// soonest shows sort first, matching the artist dashboard's ordering.
export async function listAllShows(db: Db): Promise<ShowSummary[]> {
  const rows = await db
    .select(SHOW_SUMMARY_SELECTION)
    .from(shows)
    .innerJoin(artists, eq(shows.artistId, artists.id))
    .innerJoin(venues, eq(shows.venueId, venues.id))
    .orderBy(shows.doorsAt);
  return rows.map(narrowSummary);
}

// The editable inputs ShowCreate collects. The rest of the shows row is
// either auto-generated (id, createdAt), defaulted (status='draft',
// bleacher*, showHolds), or out of scope for first creation (pausedAt,
// emailCustomization). tierFloorsCents keys must match the chosen
// architecture's row tiers; activeRowIds must be a subset of its row ids —
// both validated at the route boundary, not here.
export type NewShowInput = {
  artistId: string;
  venueId: string;
  venueArchitectureId: string;
  doorsAt: Date;
  offerWindowOpensAt: Date;
  bindingAllocationAt: Date;
  tierFloorsCents: Record<string, number>;
  activeRowIds: string[];
  maxGroupSize: number;
};

// Inserts a new show in 'draft' status and returns the created row. A show
// is born a draft: created here, then announced (→ 'open') as a separate
// deliberate step, so creating one never accidentally opens an offer window.
export async function createShow(
  db: Db,
  input: NewShowInput,
): Promise<Show> {
  const rows = await db
    .insert(shows)
    .values({
      artistId: input.artistId,
      venueId: input.venueId,
      venueArchitectureId: input.venueArchitectureId,
      doorsAt: input.doorsAt,
      offerWindowOpensAt: input.offerWindowOpensAt,
      bindingAllocationAt: input.bindingAllocationAt,
      status: "draft",
      tierFloorsCents: input.tierFloorsCents,
      activeRowIds: input.activeRowIds,
      maxGroupSize: input.maxGroupSize,
    })
    .returning();
  // .returning() always yields the inserted row; the non-null assertion is
  // safe because a single-row insert returns exactly one row.
  return rows[0]!;
}

// The outcome of an announce attempt. A draft show transitions to 'open' and
// becomes visible to fans (listOpenShows) and bindable on schedule. The
// transition is the one deliberate step that opens an offer window — see
// createShow's note.
export type AnnounceShowResult =
  | { ok: true; show: Show }
  // The conditional UPDATE matched no row. Either the show doesn't exist, or
  // it isn't a draft (already open / paused / closed / allocated / complete).
  // The caller distinguishes the two with a follow-up read so it can answer
  // 404 vs 409 correctly.
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_draft"; status: string };

// Announces a draft show: status 'draft' → 'open'. The status='draft' guard in
// the WHERE clause is the concurrency lock — two operators clicking Announce
// at the same moment can't both win, and a show that's already past draft is
// never silently re-opened (which would, e.g., re-open a closed window). On a
// no-op UPDATE we read the row back to tell "missing" from "wrong status".
export async function announceShow(
  db: Db,
  showId: string,
): Promise<AnnounceShowResult> {
  const rows = await db
    .update(shows)
    .set({ status: "open" })
    .where(and(eq(shows.id, showId), eq(shows.status, "draft")))
    .returning();

  const updated = rows[0];
  if (updated) return { ok: true, show: updated };

  // No row updated — figure out why so the route can pick the right status.
  const existing = await db
    .select({ status: shows.status })
    .from(shows)
    .where(eq(shows.id, showId))
    .limit(1);
  const current = existing[0];
  if (!current) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "not_draft", status: current.status };
}
