// GET /api/shows — list open shows for any signed-in user.
//
// Flow (per CLAUDE.md hard constraints): auth → authorization → input
// validation → repository → presenter → NextResponse.json. No query params
// yet; pagination + filters arrive when the prototype Dashboard rows demand
// them.
//
// N+1 avoidance: every per-row enrichment (offer / assignment / arch row
// for the preview) is batched into one query at the route boundary. The
// presenter stays pure — it only consumes what this handler hands it.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  createShow,
  getVenueArchitectureById,
  listOffersForUser,
  listOpenShows,
  listSeatAssignmentsByOfferIds,
  listTicketsByAssignmentIds,
  getVenueArchitecturesByIds,
  userCanManageArtist,
  userIsAdmin,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentShowSummary,
  type ShowSummaryView,
} from "@/lib/presenters";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<ShowSummaryView[] | { error: string }>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // `now` is computed once at the route boundary so every row in the
  // response shares the same reference instant — otherwise a slow query
  // could leave half the page's countdowns lagging the other half.
  const now = new Date();
  const [rows, userOffers] = await Promise.all([
    listOpenShows(db),
    listOffersForUser(db, userId),
  ]);

  // Map the caller's offers by show id so per-row lookups are O(1).
  const offerByShowId = new Map<string, (typeof userOffers)[number]>();
  for (const offer of userOffers) {
    offerByShowId.set(offer.showId, offer);
  }

  // Fetch seat assignments only for the caller's offers (a fan may have
  // many shows but only a handful of placed offers). Empty-array branch
  // is handled by listSeatAssignmentsByOfferIds.
  const userOfferIds = userOffers.map((o) => o.id);
  const assignmentByOfferId = await listSeatAssignmentsByOfferIds(
    db,
    userOfferIds,
  );

  // Two parallel follow-up fetches over the placed offers:
  //  - architectures, for the yourOffer.preview area + rowName lookup
  //  - tickets, for the yourOffer.ticketReady flag
  // Both keyed off the assignment set, so a fan with all-pool offers
  // does zero extra work here.
  const archIdsForPreview = new Set<string>();
  const assignmentIdsForTickets: string[] = [];
  for (const row of rows) {
    const offer = offerByShowId.get(row.id);
    if (!offer) continue;
    const assignment = assignmentByOfferId.get(offer.id);
    if (!assignment) continue;
    archIdsForPreview.add(row.venueArchitectureId);
    assignmentIdsForTickets.push(assignment.id);
  }
  const [architectureById, ticketByAssignmentId] = await Promise.all([
    getVenueArchitecturesByIds(db, [...archIdsForPreview]),
    listTicketsByAssignmentIds(db, assignmentIdsForTickets),
  ]);

  const view = rows.map((row) => {
    const offer = offerByShowId.get(row.id) ?? null;
    const assignment = offer ? assignmentByOfferId.get(offer.id) ?? null : null;
    let assignmentRow: { area: string; rowName: string } | null = null;
    let ticket = null;
    if (assignment) {
      const arch = architectureById.get(row.venueArchitectureId);
      assignmentRow = arch?.rows.find((r) => r.id === assignment.venueRowId) ?? null;
      ticket = ticketByAssignmentId.get(assignment.id) ?? null;
    }
    return presentShowSummary(
      row,
      now,
      DEFAULT_TZ,
      offer,
      assignment,
      assignmentRow,
      ticket,
    );
  });
  return NextResponse.json(view);
}

// ---------------------------------------------------------------------------
// POST /api/shows — create a new show (ShowCreate).
//
// Flow: auth → authorization (manages the artist, or admin) → input
// validation → architecture-dependent validation → repository. The show is
// created in 'draft'; announcing it (→ 'open') is a separate step so
// creation never accidentally opens an offer window.
// ---------------------------------------------------------------------------

// ADR-0003 working assumption: the offer window (open → binding) must be
// ≤6 days, because the card auth is held by a manual-capture PaymentIntent
// that lapses around day 7. The form collects the binding checkpoint and the
// window open; this caps the span between them.
const MAX_OFFER_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

// Shape + pure cross-field validation. Architecture-dependent checks
// (tier-floor keys, active-row subset, venue match) need a DB load and run
// in the handler below.
const CreateShowSchema = z
  .object({
    artistId: uuidParam,
    venueId: uuidParam,
    venueArchitectureId: uuidParam,
    // ISO 8601 strings from the form's datetime-local inputs; coerced to Date.
    offerWindowOpensAt: z.coerce.date(),
    bindingAllocationAt: z.coerce.date(),
    doorsAt: z.coerce.date(),
    // { premium: 4000, mid: 1800, ... } — keys validated against the
    // architecture's active-row tiers in the handler.
    tierFloorsCents: z.record(z.string().min(1), z.int().positive()),
    activeRowIds: z.array(z.string().min(1)).min(1),
    maxGroupSize: z.int().min(1).max(10).default(10),
  })
  .superRefine((d, ctx) => {
    if (d.offerWindowOpensAt >= d.bindingAllocationAt) {
      ctx.addIssue({
        code: "custom",
        path: ["bindingAllocationAt"],
        message: "binding checkpoint must be after the offer window opens",
      });
    }
    if (d.bindingAllocationAt > d.doorsAt) {
      ctx.addIssue({
        code: "custom",
        path: ["bindingAllocationAt"],
        message: "binding checkpoint must be at or before doors",
      });
    }
    if (
      d.bindingAllocationAt.getTime() - d.offerWindowOpensAt.getTime() >
      MAX_OFFER_WINDOW_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["bindingAllocationAt"],
        message:
          "offer window (open → binding) must be ≤6 days (ADR-0003 card-auth hold limit)",
      });
    }
  });

type CreateShowResponse = { ok: true; showId: string; status: "draft" };
type ErrorBody = { error: string; details?: unknown };

export async function POST(
  request: Request,
): Promise<NextResponse<CreateShowResponse | ErrorBody>> {
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
  const parsed = CreateShowSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Authorization: the caller must manage this artist, or be an admin.
  // 404 (not 403) on failure so we don't leak which artist ids exist to a
  // user who can't manage them — same posture as the rest of the app.
  const [canManage, isAdmin] = await Promise.all([
    userCanManageArtist(db, userId, body.artistId),
    userIsAdmin(db, userId),
  ]);
  if (!canManage && !isAdmin) {
    return NextResponse.json({ error: "artist not found" }, { status: 404 });
  }

  // The architecture must exist and belong to the named venue — the form
  // pairs them, but a hand-crafted request could mismatch.
  const architecture = await getVenueArchitectureById(
    db,
    body.venueArchitectureId,
  );
  if (!architecture) {
    return NextResponse.json(
      { error: "venue architecture not found" },
      { status: 400 },
    );
  }
  if (architecture.venueId !== body.venueId) {
    return NextResponse.json(
      { error: "architecture does not belong to the named venue" },
      { status: 400 },
    );
  }

  // activeRowIds must be a subset of the architecture's row ids.
  const archRowIds = new Set(architecture.rows.map((r) => r.id));
  const unknownRowIds = body.activeRowIds.filter((id) => !archRowIds.has(id));
  if (unknownRowIds.length > 0) {
    return NextResponse.json(
      {
        error: "activeRowIds contains ids not in the architecture",
        details: { unknownRowIds },
      },
      { status: 400 },
    );
  }

  // tierFloorsCents must price exactly the tiers present among the active
  // rows — no missing floor, no floor for a tier that isn't active. Rows
  // without a tier (e.g. GA) carry no tier floor and are ignored here.
  const activeRowIdSet = new Set(body.activeRowIds);
  const requiredTiers = new Set(
    architecture.rows
      .filter((r) => activeRowIdSet.has(r.id) && r.tier)
      .map((r) => r.tier as string),
  );
  const floorTiers = new Set(Object.keys(body.tierFloorsCents));
  const missingFloors = [...requiredTiers].filter((t) => !floorTiers.has(t));
  const extraFloors = [...floorTiers].filter((t) => !requiredTiers.has(t));
  if (missingFloors.length > 0 || extraFloors.length > 0) {
    return NextResponse.json(
      {
        error: "tierFloorsCents must match the active rows' tiers exactly",
        details: { missingFloors, extraFloors },
      },
      { status: 400 },
    );
  }

  const show = await createShow(db, {
    artistId: body.artistId,
    venueId: body.venueId,
    venueArchitectureId: body.venueArchitectureId,
    offerWindowOpensAt: body.offerWindowOpensAt,
    bindingAllocationAt: body.bindingAllocationAt,
    doorsAt: body.doorsAt,
    tierFloorsCents: body.tierFloorsCents,
    activeRowIds: body.activeRowIds,
    maxGroupSize: body.maxGroupSize,
  });

  return NextResponse.json(
    { ok: true, showId: show.id, status: "draft" },
    { status: 201 },
  );
}
