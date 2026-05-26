// GET /api/shows — list open shows for any signed-in user.
//
// Flow (per CLAUDE.md hard constraints): auth → authorization → input
// validation → repository → presenter → NextResponse.json. No query params
// yet; pagination + filters arrive when the prototype Dashboard rows demand
// them.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listOpenShows } from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowSummary,
  type ShowSummaryView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ShowSummaryView[] | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // `now` is computed once at the route boundary so every row in the
  // response shares the same reference instant — otherwise a slow query
  // could leave half the page's countdowns lagging the other half.
  const now = new Date();
  const rows = await listOpenShows(db);
  const view = rows.map((row) => presentShowSummary(row, now, DEFAULT_TZ));
  return NextResponse.json(view);
}
