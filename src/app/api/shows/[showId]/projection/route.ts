// POST /api/shows/[showId]/projection — the live dial's backend (Change 04).
//
// Given a fan's CANDIDATE offer (price / size / tier), return where they'd
// land right now, so the composer's map + standing line re-shade as they turn
// the dial. Read-only: runs the GAE in-memory and writes NOTHING.
//
// Flow: auth (any fan) → validate → gate on offers-open → project → present.
//
// Calm degradation (Risk Register §3.3/§3.5): when the window isn't open we
// return { available: false } rather than an error; the client shows a calm
// "offers open until {time}" instead of a broken preview. Submission lives on
// a different route and never depends on this one — preview can be down and
// offers still go through.
//
// Read-storm guard: a short-TTL in-memory cache keyed by the candidate params
// (+ caller, since we drop the caller's own pool offer) collapses a dial-drag
// — and many fans on the same params — down to one GAE run per window. It's
// best-effort, single-instance; a cache miss just recomputes.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getOfferByShowAndUser,
  getShowById,
  listPoolOffersForShow,
} from "@/lib/db/repositories";
import { projectCandidateOffer } from "@/lib/allocation/project-candidate";
import {
  presentLiveProjection,
  type LiveProjectionView,
} from "@/lib/presenters/live-preview";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ showId: uuidParam });

const BodySchema = z.object({
  pricePerTicketCents: z.int().positive(),
  groupSize: z.int().min(1).max(10),
  tierPreference: z.enum(["specific", "this_or_better", "this_or_worse", "any"]),
  preferredTier: z.string().min(1).nullish(),
  autoBidEnabled: z.boolean().default(false),
  autoBidCapCents: z.int().positive().nullish(),
});

// Best-effort, single-instance projection cache. TTL is short so it tracks the
// live pool; the cap bounds memory under a busy show.
const CACHE_TTL_MS = 8_000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map<string, { at: number; value: LiveProjectionView }>();

function cacheKey(showId: string, userId: string, body: z.infer<typeof BodySchema>): string {
  return [
    showId,
    userId,
    body.pricePerTicketCents,
    body.groupSize,
    body.tierPreference,
    body.preferredTier ?? "",
    body.autoBidEnabled ? 1 : 0,
    body.autoBidCapCents ?? "",
  ].join(":");
}

export async function POST(
  request: Request,
  { params }: { params: { showId: string } },
): Promise<NextResponse<LiveProjectionView | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsedParams = ParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "invalid showId" }, { status: 400 });
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
  const body = parsed.data;

  const show = await getShowById(db, parsedParams.data.showId);
  if (!show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Offers only project while the window is open. Anything else degrades
  // calmly on the client (not an error).
  if (show.status !== "open") {
    return NextResponse.json({ available: false, reason: "closed" } as const);
  }

  const now = new Date();
  const key = cacheKey(parsedParams.data.showId, userId, body);
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.value);
  }

  const [poolOffers, existingOffer] = await Promise.all([
    listPoolOffersForShow(db, parsedParams.data.showId),
    getOfferByShowAndUser(db, parsedParams.data.showId, userId),
  ]);

  const projection = projectCandidateOffer(
    show,
    show.venueArchitecture,
    poolOffers,
    {
      userId,
      pricePerTicketCents: body.pricePerTicketCents,
      groupSize: body.groupSize,
      tierPreference: body.tierPreference,
      preferredTier: body.preferredTier ?? null,
      autoBidEnabled: body.autoBidEnabled,
      autoBidCapCents: body.autoBidCapCents ?? null,
      // Keep the fan's place among equal offers when revising.
      submittedAt: existingOffer?.submittedAt ?? now,
    },
  );

  const rowName =
    projection.venueRowId !== null
      ? show.venueArchitecture.rows.find(
          (r) => r.id === projection.venueRowId,
        )?.rowName ?? null
      : null;

  const value = presentLiveProjection({
    pricePerTicketCents: body.pricePerTicketCents,
    groupSize: body.groupSize,
    tierPreference: body.tierPreference,
    preferredTier: body.preferredTier ?? null,
    projection,
    rowName,
    tierFloorsCents: show.tierFloorsCents as Record<string, number>,
  });

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(key, { at: now.getTime(), value });

  return NextResponse.json(value);
}
