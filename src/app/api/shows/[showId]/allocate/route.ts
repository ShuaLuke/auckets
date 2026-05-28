// POST /api/shows/[showId]/allocate — runs an allocation against the
// show's current offer pool.
//
// Flow: auth → Zod-validate path + body → admin gate (ADR-0013: even
// artists don't trigger this directly) → orchestrator → response.
//
// Mode:
//   "preview" — re-runnable, money-free; writes provisional placements.
//   "binding" — one-shot, irreversible: captures placed offers' card
//               auths, releases unplaced ones, transitions offer + show
//               statuses. Requires Stripe to be configured (503 if not).
//               The automatic T-24h trigger (an Inngest schedule) is a
//               separate slice; this is the manually-triggered path.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { userIsAdmin } from "@/lib/db/repositories";
import {
  runPreviewAllocation,
  type RunPreviewError,
  type RunPreviewResult,
} from "@/lib/allocation/run-preview";
import {
  runBindingAllocation,
  type RunBindingError,
  type RunBindingResult,
} from "@/lib/allocation/run-binding";
import { stripe } from "@/lib/stripe/client";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  showId: uuidParam,
});

const BodySchema = z.object({
  mode: z.enum(["preview", "binding"]),
});

type PreviewSuccess = {
  showId: string;
  mode: "preview";
  ranAt: string;
  stats: RunPreviewResult["stats"];
  assignmentsWritten: number;
  logsWritten: number;
};

type BindingSuccess = {
  showId: string;
  mode: "binding";
  ranAt: string;
  stats: RunBindingResult["stats"];
  assignmentsWritten: number;
  logsWritten: number;
  captured: number;
  cardFailures: number;
  cancelled: number;
};

type Success = PreviewSuccess | BindingSuccess;

type ErrorBody = { error: string };

// Both orchestrators surface the same error kinds; map them once.
function allocationErrorResponse(
  error: RunPreviewError | RunBindingError,
): NextResponse<ErrorBody> {
  switch (error.kind) {
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
        { error: `cannot allocate show with status=${error.status}` },
        { status: 409 },
      );
  }
}

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

  // AUCKETS_ADMIN gate per ADR-0013. Even artists file a request
  // rather than triggering allocation directly. Gate applies to both
  // modes.
  const allowed = await userIsAdmin(db, userId);
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (parsedBody.data.mode === "binding") {
    if (!stripe) {
      // Binding moves real money — refuse rather than silently no-op when
      // Stripe isn't configured. 503: try again once the key is set.
      return NextResponse.json(
        { error: "payments not configured" },
        { status: 503 },
      );
    }
    const outcome = await runBindingAllocation(
      db,
      stripe,
      parsedParams.data.showId,
    );
    if (!outcome.ok) {
      return allocationErrorResponse(outcome.error);
    }
    const { ranAt, ...rest } = outcome.value;
    return NextResponse.json({ ...rest, ranAt: ranAt.toISOString() });
  }

  const outcome = await runPreviewAllocation(db, parsedParams.data.showId);
  if (!outcome.ok) {
    return allocationErrorResponse(outcome.error);
  }

  const { ranAt, ...rest } = outcome.value;
  return NextResponse.json({ ...rest, ranAt: ranAt.toISOString() });
}
