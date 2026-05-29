// POST /api/offers/[offerId]/recover — card-failure recovery (ADR-0003 §5).
// The fan whose card failed at binding submits a new PaymentMethod to reclaim
// their held seat. Auth → validate → orchestrator (ownership + window +
// charge + resolve). Requires Stripe; 503 if unconfigured.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { recoverCardFailure } from "@/lib/stripe/card-failure-recovery";
import { stripe } from "@/lib/stripe/client";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ offerId: uuidParam });
const BodySchema = z.object({
  stripePaymentMethodId: z.string().startsWith("pm_"),
});

type Success = { ok: true; offerId: string; amountChargedCents: number };
type ErrorBody = { error: string; details?: unknown };

export async function POST(
  request: Request,
  { params }: { params: { offerId: string } },
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid offerId" }, { status: 400 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsedBody = BodySchema.safeParse(bodyJson);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsedBody.error.issues },
      { status: 400 },
    );
  }

  if (!stripe) {
    return NextResponse.json(
      { error: "payments not configured" },
      { status: 503 },
    );
  }

  const idempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
  const outcome = await recoverCardFailure(db, stripe, {
    offerId: parsedParams.data.offerId,
    userId,
    paymentMethodId: parsedBody.data.stripePaymentMethodId,
    windowMinutes: env.CARD_FAILURE_RECOVERY_WINDOW_MINUTES,
    now: new Date(),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  });

  if (outcome.ok) {
    return NextResponse.json({
      ok: true,
      offerId: outcome.offerId,
      amountChargedCents: outcome.amountChargedCents,
    });
  }

  switch (outcome.error.kind) {
    case "offer_not_found":
      return NextResponse.json({ error: "offer not found" }, { status: 404 });
    case "forbidden":
      // 404 (not 403) so a fan can't probe which offer ids exist.
      return NextResponse.json({ error: "offer not found" }, { status: 404 });
    case "not_recoverable":
      return NextResponse.json(
        { error: `offer is not recoverable (status=${outcome.error.status})` },
        { status: 409 },
      );
    case "no_seat":
      return NextResponse.json(
        { error: "no held seat to recover" },
        { status: 409 },
      );
    case "window_expired":
      return NextResponse.json(
        { error: "recovery window has expired" },
        { status: 410 },
      );
    case "charge_failed":
      // Card declined / needs action — fan can try another card.
      return NextResponse.json(
        { error: outcome.error.message, details: { code: outcome.error.code } },
        { status: 402 },
      );
    case "customer_error":
      return NextResponse.json(
        { error: outcome.error.message, details: { code: outcome.error.code } },
        { status: 502 },
      );
  }
}
