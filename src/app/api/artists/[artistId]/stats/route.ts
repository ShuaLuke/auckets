// GET /api/artists/[artistId]/stats — the top-of-page snapshot row on
// ArtistDashboard.jsx. Cross-show aggregate over the artist's
// pre-binding shows.
//
// Flow + authorization mirror the sibling /shows route: only artist
// members or AUCKETS_ADMIN may read. capacity_filled and
// provisional_payout from the prototype stay deferred — they need
// seat_assignments, which a later slice owns.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getOfferStatsForArtist,
  userCanManageArtist,
} from "@/lib/db/repositories";
import {
  presentArtistSnapshotStats,
  type ArtistSnapshotStatsView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  artistId: uuidParam,
});

export async function GET(
  _request: Request,
  { params }: { params: { artistId: string } },
): Promise<NextResponse<ArtistSnapshotStatsView | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid artistId" },
      { status: 400 },
    );
  }
  const { artistId } = parsed.data;

  const allowed = await userCanManageArtist(db, userId, artistId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const stats = await getOfferStatsForArtist(db, artistId);
  return NextResponse.json(presentArtistSnapshotStats(stats));
}
