// DELETE /api/holds/[id] — remove a hold from a show.
//
// Authorization splits on the hold's kind, per the schema comment in
// drizzle/schema.ts §17:
//   - kind='artist' — artist member OR AUCKETS_ADMIN can delete
//   - kind='venue'  — AUCKETS_ADMIN only (artist members can't remove
//     ADA / sound desk / production holds)
//
// Flow: auth → load the hold (so we know the show + kind) → load the
// show (so we know the artist_id for the membership check) →
// kind-specific authorization → delete.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  deleteHoldById,
  getHoldById,
  getShowById,
  userCanManageArtist,
  userIsAdmin,
} from "@/lib/db/repositories";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: uuidParam });

type Success = { id: string };
type ErrorBody = { error: string };

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const hold = await getHoldById(db, parsedParams.data.id);
  if (!hold) {
    // 404 — caller asked to delete a hold that doesn't exist. Also
    // covers the "already deleted" race; surfacing it is less
    // misleading than silently returning 200.
    return NextResponse.json({ error: "hold not found" }, { status: 404 });
  }

  if (hold.kind === "venue") {
    const isAdmin = await userIsAdmin(db, userId);
    if (!isAdmin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    // artist-kind: the show's artist must be manageable by the caller.
    // Loading the show is cheap and the most explicit path; the
    // alternative of routing through userIsAdmin first to short-
    // circuit would be a few µs faster but less readable.
    const show = await getShowById(db, hold.showId);
    if (!show) {
      // FK to shows is RESTRICT — if a hold exists, its show exists.
      // Surface loudly rather than silently 403'ing.
      return NextResponse.json(
        { error: "show missing for hold" },
        { status: 500 },
      );
    }
    const allowed = await userCanManageArtist(db, userId, show.artistId);
    if (!allowed) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const deleted = await deleteHoldById(db, parsedParams.data.id);
  if (!deleted) {
    // Lost a race against another concurrent delete. Treat as
    // already-done from the client's perspective.
    return NextResponse.json({ error: "hold not found" }, { status: 404 });
  }

  return NextResponse.json({ id: deleted.id });
}
