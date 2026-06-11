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
//               On a show stuck in 'allocating' (a previous run's Phase 1
//               committed but its settlement died), binding mode RESUMES
//               the settlement instead of bouncing 409 — the manual
//               recovery lever alongside the scheduled sweep's automatic
//               one. The scheduled trigger lives in
//               src/lib/jobs/functions/scheduled-binding.ts; this is the
//               manually-triggered path.

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
  resumeBindingAllocation,
  runBindingAllocation,
  type RunBindingError,
  type RunBindingResult,
} from "@/lib/allocation/run-binding";
import { stripe } from "@/lib/stripe/client";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";
// Binding captures N placed offers' PaymentIntents sequentially against the
// Stripe API — a popular show is minutes of network I/O, not seconds.
// Without this export the route runs under Vercel's default function
// timeout (~15s on Pro) and a mid-capture kill is exactly the stuck-
// 'allocating' failure mode this slice exists to recover from. 300s is the
// Pro-plan ceiling without Fluid Compute and comfortably covers ~100+
// captures; past that scale the scheduled sweep (batched Inngest steps,
// each its own invocation) is the right trigger, and even a timeout here is
// now recoverable (resume). Preview shares the route but is one DB
// transaction — the long ceiling is harmless for it.
export const maxDuration = 300;

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

// A resumed binding settlement (the show was 'allocating'). No stats /
// assignmentsWritten: the placement decision was Phase 1's, made by the
// earlier crashed run — this invocation only settled the remaining money
// movement.
type BindingResumeSuccess = {
  showId: string;
  mode: "binding";
  resumed: true;
  ranAt: string;
  captured: number;
  cardFailures: number;
  cancelled: number;
};

type Success = PreviewSuccess | BindingSuccess | BindingResumeSuccess;

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
      // 'allocating' means a previous run's Phase 1 committed but its
      // settlement died (or is in flight — resume is concurrency-safe
      // either way: capture CAS + idempotency keys, finalize CAS). Resume
      // instead of bouncing so ops' "Run binding" click is also the manual
      // un-stick lever. Any race that moves the show out of 'allocating'
      // before the resume's status check falls through to the normal 409.
      if (
        outcome.error.kind === "show_not_eligible" &&
        outcome.error.status === "allocating"
      ) {
        const resume = await resumeBindingAllocation(
          db,
          stripe,
          parsedParams.data.showId,
        );
        if (!resume.ok) {
          return allocationErrorResponse(resume.error);
        }
        // `finalized` is internal bookkeeping (did THIS pass win the flip);
        // the response carries the settlement counts only.
        const { ranAt, finalized, ...rest } = resume.value;
        void finalized;
        return NextResponse.json({ ...rest, ranAt: ranAt.toISOString() });
      }
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
