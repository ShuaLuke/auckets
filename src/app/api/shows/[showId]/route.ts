// GET /api/shows/[showId] — show detail for the offer composer.
//
// Flow: auth → Zod-validate path param → repository → presenter →
// NextResponse.json. Per-user state (yourOffer) is fetched via the offers
// repository and handed into the presenter — the presenter itself stays
// pure (no DB).

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getShowById,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowDetail,
  type ShowDetailView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: z.uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: { showId: string } },
): Promise<NextResponse<ShowDetailView | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid showId" },
      { status: 400 },
    );
  }

  const [show, userOffer] = await Promise.all([
    getShowById(db, parsed.data.showId),
    getOfferByShowAndUser(db, parsed.data.showId, userId),
  ]);
  if (!show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date();
  return NextResponse.json(
    presentShowDetail(show, now, DEFAULT_TZ, userOffer),
  );
}
