// POST /api/scan — door-staff endpoint that validates a scanned rotating-QR
// token and admits the fan (Scanner, ADR-0015). Auth → VENUE_STAFF /
// AUCKETS_ADMIN gate → process → return the outcome.
//
// Returns 200 with the scan result even for invalid/replay/expired — those
// are valid SCAN OUTCOMES (the door UI branches on `result`), not transport
// errors. Non-2xx is reserved for "you can't scan" (401/403) and bad input.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { userCanScan } from "@/lib/db/repositories";
import { processTicketScan } from "@/lib/tickets/scan";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  token: z.string().min(1).max(512),
});

type Success = { result: string; reason?: string; ticketId: string | null };
type ErrorBody = { error: string };

export async function POST(
  request: Request,
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const allowed = await userCanScan(db, userId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const outcome = await processTicketScan(db, {
    token: parsed.data.token,
    staffId: userId,
  });

  return NextResponse.json({
    result: outcome.result,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ticketId: outcome.ticketId,
  });
}
