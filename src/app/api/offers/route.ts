// POST /api/offers — DEV STUB.
//
// Submits or revises an offer for the calling user. Bypasses Stripe
// (placeholder stripe_payment_method_id / stripe_setup_intent_id) so
// the bid flow is exercisable end-to-end before ADR-0003 (SetupIntent
// vs. pre-auth hold-window) is finalized.
//
// Gating: env.ALLOW_DEV_OFFER_STUB must be "true". The env validator
// refuses "true" in production at module load, so this endpoint
// cannot accidentally ship live.
//
// Flow: auth → env flag → Zod body → ensure local users row exists →
// fetch + validate show → upsert offer → respond.
//
// Out of scope for this slice:
//   - Idempotency keys (offer_idempotency_keys table). The real
//     submission needs them per ADR-0010; the stub relies on the
//     (show_id, user_id) UNIQUE upsert path instead.
//   - "Revise upward only" rule. Real submission must reject downward
//     revisions; the stub accepts any revision so end-to-end dev
//     testing isn't blocked by it.
//   - Inngest event emission (e.g. "trigger preview allocation").
//     Preview is admin-triggered today; cron lands in a later slice.

import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  ensureUserMirror,
  getShowById,
  upsertOfferForUser,
} from "@/lib/db/repositories";
import { env } from "@/lib/env";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

// Schema mirrors the offers table CHECK constraints
// (drizzle/schema.ts §7) so the validator catches what the DB would
// reject anyway, with friendlier error messages.
const BodySchema = z
  .object({
    showId: uuidParam,
    groupSize: z.int().min(1).max(10),
    pricePerTicketCents: z.int().positive(),
    tierPreference: z.enum([
      "specific",
      "this_or_better",
      "this_or_worse",
      "any",
    ]),
    preferredTier: z.string().min(1).optional(),
    channel: z.enum(["market", "bleacher"]).default("market"),
    autoBidEnabled: z.boolean().default(false),
    autoBidCapCents: z.int().positive().optional(),
    autoBidIncrementCents: z.int().positive().default(500),
    // ADR-0017 — server-only. Accepted on input but never echoed back
    // to other users; the GET /api/shows/[id] response strips it via
    // the presenter.
    privateThresholdCents: z.int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    // Mirror the DB CHECK: when autoBidEnabled, the cap must be set
    // AND >= pricePerTicketCents.
    if (data.autoBidEnabled) {
      if (data.autoBidCapCents === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["autoBidCapCents"],
          message: "autoBidCapCents required when autoBidEnabled",
        });
      } else if (data.autoBidCapCents < data.pricePerTicketCents) {
        ctx.addIssue({
          code: "custom",
          path: ["autoBidCapCents"],
          message: "autoBidCapCents must be >= pricePerTicketCents",
        });
      }
    }
    // Tier-bound preferences need preferredTier set. 'any' must not
    // carry one (it'd be misleading).
    if (data.tierPreference !== "any" && !data.preferredTier) {
      ctx.addIssue({
        code: "custom",
        path: ["preferredTier"],
        message: `preferredTier required when tierPreference is "${data.tierPreference}"`,
      });
    }
    if (data.tierPreference === "any" && data.preferredTier) {
      ctx.addIssue({
        code: "custom",
        path: ["preferredTier"],
        message: 'preferredTier must be omitted when tierPreference is "any"',
      });
    }
  });

type SubmitResponse = {
  ok: true;
  offerId: string;
  isRevision: boolean;
  showId: string;
};

type ErrorBody = { error: string; details?: unknown };

const SHOW_OPEN_STATUSES = new Set(["open"]);

// Placeholder Stripe IDs encode the userId + a timestamp so they're
// unique per submission and obviously fake to any human inspecting
// the row. Real submission uses real Stripe IDs from a confirmed
// SetupIntent.
function stubStripeIds(userId: string) {
  const tag = `${userId}_${Date.now()}`;
  return {
    stripePaymentMethodId: `pm_dev_${tag}`,
    stripeSetupIntentId: `seti_dev_${tag}`,
  };
}

export async function POST(
  request: Request,
): Promise<NextResponse<SubmitResponse | ErrorBody>> {
  if (env.ALLOW_DEV_OFFER_STUB !== "true") {
    return NextResponse.json(
      {
        error:
          "offer submission disabled. Set ALLOW_DEV_OFFER_STUB=true to enable the dev stub, or wait for the real Stripe-backed endpoint (blocked on ADR-0003).",
      },
      { status: 503 },
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Ensure the local users mirror exists before the FK fires. Email is
  // pulled from Clerk; primaryEmailAddress is always set for verified
  // accounts. Fallback uses the Clerk user_id in a placeholder domain
  // so the email-UNIQUE constraint doesn't block a corner-case account
  // without a primary email (rare but possible during signup).
  const clerk = await currentUser();
  const email =
    clerk?.primaryEmailAddress?.emailAddress ??
    `${userId}@placeholder.auckets.local`;
  await ensureUserMirror(db, { id: userId, email });

  // Show must exist and be eligible to accept offers. 'open' only —
  // paused / closed / allocating / allocated / complete all reject
  // with 409. Time-window enforcement (offerWindowOpensAt) is part of
  // the real flow; the dev stub trusts the status enum.
  const show = await getShowById(db, body.showId);
  if (!show) {
    return NextResponse.json({ error: "show not found" }, { status: 404 });
  }
  if (!SHOW_OPEN_STATUSES.has(show.status)) {
    return NextResponse.json(
      { error: `show is not accepting offers (status=${show.status})` },
      { status: 409 },
    );
  }

  const { offer, isRevision } = await upsertOfferForUser(db, {
    showId: body.showId,
    userId,
    groupSize: body.groupSize,
    pricePerTicketCents: body.pricePerTicketCents,
    tierPreference: body.tierPreference,
    preferredTier: body.preferredTier ?? null,
    channel: body.channel,
    autoBidEnabled: body.autoBidEnabled,
    autoBidCapCents: body.autoBidCapCents ?? null,
    autoBidIncrementCents: body.autoBidIncrementCents,
    privateThresholdCents: body.privateThresholdCents ?? null,
    ...stubStripeIds(userId),
  });

  return NextResponse.json(
    {
      ok: true,
      offerId: offer.id,
      isRevision,
      showId: offer.showId,
    },
    { status: isRevision ? 200 : 201 },
  );
}
