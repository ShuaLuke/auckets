// Read/write helpers for the artist_requests table. Per ADR-0013:
// artists file requests (comp / override / pause / end_early) through
// the dashboard; AUCKETS ops staff execute them. This module covers
// the write side (artist files) and the read side (admin inbox); the
// execution-side helpers land when the admin inbox UI ships.

import { and, desc, eq } from "drizzle-orm";

import type { Db } from "@/lib/db";
import { artistRequests } from "../../../../drizzle/schema";

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
