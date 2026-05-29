// POST /api/displacement-events/[id]/acknowledge — dismiss an in-app
// displacement alert (ADR-0018 §4). Stamps acknowledged_at so the alert
// drops out of the fan's unacknowledged inbox on the next render.
//
// Authorization: the repo scopes the update to the calling user, so a fan
// can only acknowledge their own alerts. A no-match (someone else's id, a
// bad id, or already acknowledged) returns 404 — there's nothing of theirs
// to act on.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { acknowledgeDisplacementEvent } from "@/lib/db/repositories";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ id: uuidParam });

type Success = { id: string };
type ErrorBody = { error: string };

export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const updated = await acknowledgeDisplacementEvent(
    db,
    parsed.data.id,
    userId,
  );
  if (updated === 0) {
    // Not found, not theirs, or already acknowledged — nothing to do.
    return NextResponse.json(
      { error: "alert not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ id: parsed.data.id });
}
