// POST /api/artist-requests — file a request from the ShowAdmin page.
// Per ADR-0013: artists request (comp / override / pause / end_early);
// AUCKETS ops execute. This endpoint only handles the filing side;
// the admin-execute flow lands in a later slice.
//
// Flow: auth → ensure user mirror → Zod-validate body → authorization
// (caller can manage the artist that owns the show) → repo write →
// 201 with the created row's id.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  ARTIST_REQUEST_KINDS,
  createArtistRequest,
  ensureUserMirror,
  getShowById,
  userCanManageArtist,
} from "@/lib/db/repositories";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  showId: uuidParam,
  kind: z.enum(ARTIST_REQUEST_KINDS),
  details: z.string().trim().min(1, "details required").max(2000),
});

type Success = { id: string; createdAt: string };
type ErrorBody = { error: string };

export async function POST(
  request: Request,
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  // Look up the show first so we can authorize against its artist_id.
  const show = await getShowById(db, parsed.data.showId);
  if (!show) {
    return NextResponse.json({ error: "show not found" }, { status: 404 });
  }

  const allowed = await userCanManageArtist(db, userId, show.artistId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Clerk owns user auth; we mirror just enough for the FK. This is
  // the same lazy-mirror pattern POST /api/offers uses today, and the
  // Clerk webhook will replace it.
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email) {
    return NextResponse.json(
      { error: "no email on Clerk user" },
      { status: 400 },
    );
  }
  await ensureUserMirror(db, { id: userId, email });

  const row = await createArtistRequest(db, {
    showId: parsed.data.showId,
    requestedBy: userId,
    kind: parsed.data.kind,
    details: parsed.data.details,
  });

  return NextResponse.json(
    { id: row.id, createdAt: row.createdAt.toISOString() },
    { status: 201 },
  );
}
