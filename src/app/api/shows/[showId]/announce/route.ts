// POST /api/shows/[showId]/announce — announces a draft show, transitioning
// it 'draft' → 'open' so fans can see it (listOpenShows) and submit offers,
// and so the scheduled-binding cron will pick it up at its checkpoint.
//
// Flow: auth → Zod-validate path → authorization (artist member of the show's
// artist, OR AUCKETS_ADMIN) → guarded UPDATE → response.
//
// Authorization differs from /allocate: announcing is a routine show-setup
// step the artist owns, not a money-moving / ADR-0013-gated action. So an
// artist member of the show's own artist may announce their own show; they
// don't have to file a request. We resolve the show first to learn its
// artist, then check manage rights against that artist.
//
// Status mapping mirrors the artist-request executor:
//   200 — announced (draft → open)
//   404 — show doesn't exist (or caller can't see it — see note below)
//   409 — show exists but isn't a draft (already open / closed / etc.)

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  announceShow,
  getShowById,
  userCanManageArtist,
} from "@/lib/db/repositories";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

type Success = {
  showId: string;
  status: "open";
};
type ErrorBody = { error: string };

export async function POST(
  _request: Request,
  { params }: { params: { showId: string } },
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid showId" }, { status: 400 });
  }
  const { showId } = parsedParams.data;

  // Resolve the show to learn its artist for the authorization check. A
  // missing show is a 404 here — before we reveal anything else. (Unlike the
  // admin-only routes, we don't need to mask existence: an artist member who
  // can't manage the show's artist gets the same 404 below.)
  const show = await getShowById(db, showId);
  if (!show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Artist member of the show's own artist, or AUCKETS_ADMIN. 404 over 403 so
  // a member of a *different* artist can't probe which show ids exist.
  const allowed = await userCanManageArtist(db, userId, show.artistId);
  if (!allowed) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result = await announceShow(db, showId);
  if (!result.ok) {
    if (result.reason === "not_found") {
      // Raced with a delete between getShowById and the UPDATE — vanishingly
      // unlikely (shows aren't hard-deleted) but mapped honestly.
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // not_draft: already announced or past the offer window. 409 conflict.
    return NextResponse.json(
      { error: `cannot announce show with status=${result.status}` },
      { status: 409 },
    );
  }

  return NextResponse.json({ showId, status: "open" });
}
