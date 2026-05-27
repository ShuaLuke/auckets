// Read/write helpers for the artist_requests table. Per ADR-0013:
// artists file requests (comp / override / pause / end_early) through
// the dashboard; AUCKETS ops staff execute them. This module covers
// the file side, the inbox-read side, and the execute/deny actions
// the admin inbox uses to close out a request.

import { and, desc, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import {
  artistRequests,
  artists,
  shows,
  users,
  venues,
} from "../../../../drizzle/schema";

export type ArtistRequest = typeof artistRequests.$inferSelect;
export type ArtistRequestInsert = typeof artistRequests.$inferInsert;

// Kinds the dialog surfaces today. Schema stores as text so adding a
// new kind doesn't require a migration; the route handler enforces
// this union via Zod at the boundary.
export const ARTIST_REQUEST_KINDS = [
  "comp",
  "override",
  "pause",
  "end_early",
] as const;
export type ArtistRequestKind = (typeof ARTIST_REQUEST_KINDS)[number];

// Statuses the workflow surfaces. open = filed, awaiting ops;
// executed = ops did the thing; denied = ops declined with notes.
export const ARTIST_REQUEST_STATUSES = ["open", "executed", "denied"] as const;
export type ArtistRequestStatus = (typeof ARTIST_REQUEST_STATUSES)[number];

export async function createArtistRequest(
  db: Db,
  params: {
    showId: string;
    requestedBy: string;
    kind: ArtistRequestKind;
    details: string;
  },
): Promise<ArtistRequest> {
  const rows = await db
    .insert(artistRequests)
    .values({
      showId: params.showId,
      requestedBy: params.requestedBy,
      kind: params.kind,
      details: params.details,
    })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error(
      `createArtistRequest: no row returned (showId=${params.showId})`,
    );
  }
  return row;
}

// Per-show request history. Used by the ShowAdmin "previous requests"
// panel (not in this slice) and as the artist's confirmation they
// filed something.
export async function listArtistRequestsForShow(
  db: Db,
  showId: string,
): Promise<ArtistRequest[]> {
  return db
    .select()
    .from(artistRequests)
    .where(eq(artistRequests.showId, showId))
    .orderBy(desc(artistRequests.createdAt));
}

// Open-request inbox across all shows. Drives the AUCKETS admin
// inbox UI (also not in this slice — listed here so the next admin-
// side slice has it ready). Ordered oldest-first so ops works
// FIFO. Filter status='open' is the common case; pass through the
// status filter for the admin inbox's tab strip.
export async function listOpenArtistRequests(
  db: Db,
  status: ArtistRequestStatus = "open",
): Promise<ArtistRequest[]> {
  return db
    .select()
    .from(artistRequests)
    .where(eq(artistRequests.status, status))
    .orderBy(artistRequests.createdAt);
}

// Authorization helper: did the caller file this request? Combined
// with the admin check at the route layer, this lets a future
// "withdraw my request" path scope the action to the original
// filer.
export async function isArtistRequestFiledBy(
  db: Db,
  requestId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: artistRequests.id })
    .from(artistRequests)
    .where(
      and(eq(artistRequests.id, requestId), eq(artistRequests.requestedBy, userId)),
    )
    .limit(1);
  return rows.length > 0;
}

// Admin-inbox row shape. Joins shows/artists/venues + the filer's
// email so the inbox UI can render show context without N+1 queries.
// Executor email is included when the row has been actioned; null
// otherwise. Note: executor join uses a separate alias from the filer
// because the two can be different users; Drizzle requires aliasing for
// the same table to participate twice in one query.
export type ArtistRequestInboxRow = ArtistRequest & {
  filerEmail: string;
  showVenueName: string;
  showVenueCity: string | null;
  showDoorsAt: Date;
  artistId: string;
  artistName: string;
};

// Returns all artist_requests rows with the given status, joined to the
// show / artist / venue / filer context the admin inbox needs. Open
// requests come back oldest-first (FIFO); actioned (executed/denied)
// rows come back newest-first so recently-handled items lead the tab.
export async function listArtistRequestsForAdminInbox(
  db: Db,
  status: ArtistRequestStatus,
): Promise<ArtistRequestInboxRow[]> {
  const orderBy =
    status === "open" ? artistRequests.createdAt : desc(artistRequests.createdAt);
  const rows = await db
    .select({
      // artistRequests.* — list explicitly to keep the shape stable
      // against schema growth (a future column wouldn't silently
      // change the public type).
      id: artistRequests.id,
      showId: artistRequests.showId,
      requestedBy: artistRequests.requestedBy,
      kind: artistRequests.kind,
      details: artistRequests.details,
      status: artistRequests.status,
      executedBy: artistRequests.executedBy,
      executedAt: artistRequests.executedAt,
      notes: artistRequests.notes,
      createdAt: artistRequests.createdAt,
      // Joined context.
      filerEmail: users.email,
      showVenueName: venues.name,
      showVenueCity: venues.city,
      showDoorsAt: shows.doorsAt,
      artistId: artists.id,
      artistName: artists.name,
    })
    .from(artistRequests)
    .innerJoin(users, eq(users.id, artistRequests.requestedBy))
    .innerJoin(shows, eq(shows.id, artistRequests.showId))
    .innerJoin(artists, eq(artists.id, shows.artistId))
    .innerJoin(venues, eq(venues.id, shows.venueId))
    .where(eq(artistRequests.status, status))
    .orderBy(orderBy);
  return rows;
}

// Conditional update: execute IFF the row is still open. Returns the
// updated row, or null if the row was missing or already actioned —
// callers translate that into a 404/409 at the route layer. Optional
// notes record an operator memo (e.g. "comped 4 to row F").
export async function executeArtistRequest(
  db: Db,
  params: { requestId: string; executorId: string; notes?: string },
): Promise<ArtistRequest | null> {
  const rows = await db
    .update(artistRequests)
    .set({
      status: "executed",
      executedBy: params.executorId,
      executedAt: new Date(),
      notes: params.notes ?? null,
    })
    .where(
      and(
        eq(artistRequests.id, params.requestId),
        // The status guard is the concurrency lock — two operators
        // hitting Execute at the same moment can't both win.
        eq(artistRequests.status, "open"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

// Same shape as executeArtistRequest but writes status='denied' and
// requires notes. Denials need an operator explanation so the artist
// can be told why; the route layer enforces notes-non-empty via Zod.
export async function denyArtistRequest(
  db: Db,
  params: { requestId: string; executorId: string; notes: string },
): Promise<ArtistRequest | null> {
  const rows = await db
    .update(artistRequests)
    .set({
      status: "denied",
      executedBy: params.executorId,
      executedAt: new Date(),
      notes: params.notes,
    })
    .where(
      and(
        eq(artistRequests.id, params.requestId),
        eq(artistRequests.status, "open"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
