// GET /api/shows/[showId] — show detail for the offer composer.
//
// Flow: auth → Zod-validate path param → repository → presenter →
// NextResponse.json. Public detail (not per-user) — yourOffer arrives in
// slice 4 with the offers repository.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getShowById } from "@/lib/db/repositories";
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

  const show = await getShowById(db, parsed.data.showId);
  if (!show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = new Date();
  return NextResponse.json(presentShowDetail(show, now, DEFAULT_TZ));
}
