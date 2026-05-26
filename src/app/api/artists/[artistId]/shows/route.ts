// GET /api/artists/[artistId]/shows — artist-scoped show list for the
// Artist Dashboard. Only members of that artist (or AUCKETS_ADMIN) may read.
//
// Flow: auth → authorization (artist_members OR role=AUCKETS_ADMIN) →
// Zod-validate path param → repository → presenter → NextResponse.json.
// Each row carries the per-show offer aggregate (count + median + top)
// via getOfferStatsByShowIds — a single GROUP BY query rather than one
// query per show.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getOfferStatsByShowIds,
  listShowsForArtist,
  userCanManageArtist,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentArtistShowSummary,
  type ArtistShowSummaryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  artistId: z.uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: { artistId: string } },
): Promise<NextResponse<ArtistShowSummaryView[] | { error: string }>> {
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

  const now = new Date();
  const rows = await listShowsForArtist(db, artistId);
  const stats = await getOfferStatsByShowIds(
    db,
    rows.map((r) => r.id),
  );
  const view = rows.map((row) =>
    presentArtistShowSummary(
      row,
      // getOfferStatsByShowIds backfills zero-stats for any show that
      // wasn't in the GROUP BY result, so this lookup is total — the
      // ?? branch is belt-and-braces.
      stats.get(row.id) ?? { count: 0, medianCents: null, topCents: null },
      now,
      DEFAULT_TZ,
    ),
  );
  return NextResponse.json(view);
}
