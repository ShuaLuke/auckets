// PATCH /api/artist-requests/[id] — ops executes or denies an artist
// request from the admin inbox. Per ADR-0013, AUCKETS staff own the
// execute/deny gesture; the artist files via POST /api/artist-requests
// but doesn't transition status.
//
// Flow: auth → admin gate → Zod-validate path + body → conditional
// UPDATE (status='open') → fire best-effort ops notifications (Slack +
// email) → 200 with the updated row, 409 if the row was already
// actioned, 404 if it doesn't exist.
//
// Notifications use Promise.allSettled internally so a Slack or
// Resend failure never surfaces as an HTTP error. The notification
// context (artist name, show venue, filer email) is loaded after the
// UPDATE via two fast indexed lookups.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  denyArtistRequest,
  ensureUserMirror,
  executeArtistRequest,
  getEmailsByUserIds,
  getShowById,
  userIsAdmin,
} from "@/lib/db/repositories";
import {
  KIND_LABELS,
  notifyRequestActioned,
} from "@/lib/notifications";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  id: uuidParam,
});

// Two shapes: execute (notes optional) and deny (notes required, since
// the artist needs a reason). Modeled as a discriminated union so the
// body schema enforces the rule at the validator boundary rather than
// in handler code.
const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("execute"),
    notes: z.string().trim().max(2000).optional(),
  }),
  z.object({
    action: z.literal("deny"),
    notes: z.string().trim().min(1, "notes required when denying").max(2000),
  }),
]);

type Success = {
  id: string;
  status: "executed" | "denied";
  executedAt: string;
};
type ErrorBody = { error: string };

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const parsedBody = BodySchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: parsedBody.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  // Admin-only per ADR-0013. The repo helpers don't recheck — the
  // route layer is the authorization boundary.
  const allowed = await userIsAdmin(db, userId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Same lazy-mirror posture as POST /api/artist-requests. The
  // executedBy FK requires the local users row exist; an admin who
  // has never filed an offer/request might not be mirrored yet.
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email) {
    return NextResponse.json(
      { error: "no email on Clerk user" },
      { status: 400 },
    );
  }
  await ensureUserMirror(db, { id: userId, email });

  const row =
    parsedBody.data.action === "execute"
      ? await executeArtistRequest(db, {
          requestId: parsedParams.data.id,
          executorId: userId,
          ...(parsedBody.data.notes ? { notes: parsedBody.data.notes } : {}),
        })
      : await denyArtistRequest(db, {
          requestId: parsedParams.data.id,
          executorId: userId,
          notes: parsedBody.data.notes,
        });

  if (!row) {
    // The conditional UPDATE matched no row. Either the request was
    // already actioned (most likely, since the inbox shows open) or
    // the id is bogus. 409 captures both — surfacing "missing or
    // already actioned" is more useful to ops than 404 here, since
    // the inbox UI is the only caller and concurrent action is the
    // realistic failure.
    return NextResponse.json(
      { error: "request not open" },
      { status: 409 },
    );
  }

  // executedAt is non-null because the UPDATE sets it. Narrow at the
  // boundary so the response type doesn't lie.
  if (!row.executedAt) {
    throw new Error(
      `executeArtistRequest/denyArtistRequest returned a row without executedAt: ${row.id}`,
    );
  }

  // Fire ops notifications (Slack + email) before responding. Both
  // channels are best-effort and errors are caught inside
  // notifyRequestActioned, so this never throws. We load show context
  // + filer email in parallel — two fast indexed lookups.
  const [showRow, emailMap] = await Promise.all([
    getShowById(db, row.showId),
    getEmailsByUserIds(db, [row.requestedBy]),
  ]);
  await notifyRequestActioned({
    requestId: row.id,
    kindLabel: KIND_LABELS[row.kind] ?? row.kind,
    status: row.status as "executed" | "denied",
    executorNotes: row.notes,        // schema field: artist_requests.notes
    executorEmail: email,
    filerEmail: emailMap.get(row.requestedBy) ?? row.requestedBy,
    artistName: showRow?.artist.name ?? "unknown",
    showContext: [showRow?.venue.name, showRow?.venue.city]
      .filter(Boolean)
      .join(" · "),
  });

  return NextResponse.json({
    id: row.id,
    status: row.status as "executed" | "denied",
    executedAt: row.executedAt.toISOString(),
  });
}
