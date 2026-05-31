// POST /api/shows/[showId]/transition — direct ops lifecycle controls that
// move a live show between its running states:
//
//   pause   'open'            → 'paused'   (halts the offer window)
//   resume  'paused'          → 'open'     (reopens it)
//   close   'open' | 'paused' → 'closed'   ("end early" — window close only)
//
// Flow: auth → Zod-validate path + body → admin gate → guarded transition →
// typed response. Mirrors /announce's structure, but admin-only like
// /allocate: per ADR-0013 even artists file a Request action rather than
// halting/ending a show directly. Resume is ops-only by the same rule — there
// is no artist-facing resume path, so this endpoint is its only trigger.
//
// The transition helpers (pauseShow / resumeShow / closeShow in the shows
// repo) carry a WHERE-clause status guard, so this route is a thin wrapper: it
// dispatches by action and maps the typed result to a status code. None of the
// three captures a card — close is deliberately window-close-only; binding
// stays a separate, explicit step (POST /api/shows/[showId]/allocate).
//
// Status mapping (shared with the artist-request executor):
//   200 — transitioned; body carries the new status
//   404 — show doesn't exist (raced with a delete)
//   409 — show exists but isn't in a state this action can leave

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  closeShow,
  pauseShow,
  resumeShow,
  userIsAdmin,
  type ShowTransitionResult,
} from "@/lib/db/repositories";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

const BodySchema = z.object({
  action: z.enum(["pause", "resume", "close"]),
});

type Action = z.infer<typeof BodySchema>["action"];

// The status each action lands the show in on success — echoed back so the
// client can reflect the new state without re-reading the row.
const RESULT_STATUS: Record<Action, "paused" | "open" | "closed"> = {
  pause: "paused",
  resume: "open",
  close: "closed",
};

type Success = {
  showId: string;
  status: "paused" | "open" | "closed";
};
type ErrorBody = { error: string };

export async function POST(
  request: Request,
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

  // Body parsing — fall through to "invalid body" rather than 500 on malformed
  // JSON. Empty body → action missing → Zod catches it.
  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsedBody = BodySchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { action } = parsedBody.data;

  // AUCKETS_ADMIN gate per ADR-0013. The admin check is the whole
  // authorization here — unlike /announce, there's no artist-self path: pause,
  // resume, and end-early are ops actions. 403 (not 404) because the route
  // doesn't reveal a show id the way /announce's existence-probe concern does.
  const allowed = await userIsAdmin(db, userId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let result: ShowTransitionResult;
  switch (action) {
    case "pause":
      result = await pauseShow(db, showId, new Date());
      break;
    case "resume":
      result = await resumeShow(db, showId);
      break;
    case "close":
      result = await closeShow(db, showId);
      break;
  }

  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // wrong_status: the show isn't in a state this action can leave (e.g.
    // resume on an open show, pause on a closed one). 409 names the offender.
    return NextResponse.json(
      { error: `cannot ${action} show with status=${result.status}` },
      { status: 409 },
    );
  }

  return NextResponse.json({ showId, status: RESULT_STATUS[action] });
}
