// POST /api/shows/[showId]/allocate — runs an allocation against the
// show's current offer pool.
//
// Flow: auth → admin gate (ADR-0013: even artists don't trigger this
// directly) → Zod-validate path + body → orchestrator → response.
//
// Mode: only "preview" in this slice. mode="binding" returns 501 —
// binding has additional concerns (offer.status transitions, show
// status transitions, PaymentIntent creation, ticket scheduling) that
// land in their own slice.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { userIsAdmin } from "@/lib/db/repositories";
import {
  runPreviewAllocation,
  type RunPreviewResult,
} from "@/lib/allocation/run-preview";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

const BodySchema = z.object({
  mode: z.enum(["preview", "binding"]),
});

type Success = {
  showId: string;
  mode: "preview";
  ranAt: string;
  stats: RunPreviewResult["stats"];
  assignmentsWritten: number;
  logsWritten: number;
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

  // Body parsing — fall through to "invalid body" rather than 500 on
  // malformed JSON. Empty body → mode is missing → Zod catches it.
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

  if (parsedBody.data.mode === "binding") {
    // Explicit 501 — binding mode is recognized but not yet built.
    // Surfaces the gap loudly instead of accepting and doing the
    // wrong thing.
    return NextResponse.json(
      { error: "binding mode not yet implemented" },
      { status: 501 },
    );
  }

  // AUCKETS_ADMIN gate per ADR-0013. Even artists file a request
  // rather than triggering allocation directly.
  const allowed = await userIsAdmin(db, userId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const outcome = await runPreviewAllocation(db, parsedParams.data.showId);
  if (!outcome.ok) {
    switch (outcome.error.kind) {
      case "show_not_found":
        return NextResponse.json({ error: "not found" }, { status: 404 });
      case "architecture_not_found":
        // Shouldn't happen with RESTRICT FKs but worth surfacing.
        return NextResponse.json(
          { error: "venue architecture missing" },
          { status: 500 },
        );
      case "show_not_eligible":
        return NextResponse.json(
          {
            error: `cannot run preview on show with status=${outcome.error.status}`,
          },
          { status: 409 },
        );
    }
  }

  const { ranAt, ...rest } = outcome.value;
  return NextResponse.json({ ...rest, ranAt: ranAt.toISOString() });
}
