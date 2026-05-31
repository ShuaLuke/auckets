// POST /api/venues — create a venue + its first seat-map architecture from a
// compact tier spec. Backs the inline "create a new venue" path in
// ShowCreate.
//
// Flow: auth → authorization (admin, or manages ≥1 artist — venue creation
// is an operator action, not artist-scoped) → input validation → generate
// rows (pure helper) → createVenue + createVenueArchitecture. Returns the new
// venue + architecture ids and the generated rows so the caller can
// immediately create a show against them.
//
// Scope: the simple generator (uniform rows per tier). The full per-row
// VenueBuilder (sections, parity, lean, holds) stays post-beta.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  createVenue,
  createVenueArchitecture,
  listArtistsManageableByUser,
  userIsAdmin,
} from "@/lib/db/repositories";
import { generateArchitectureRows } from "@/lib/venues/generate-architecture";

export const dynamic = "force-dynamic";

const TierSpecSchema = z.object({
  name: z.string().min(1).max(40),
  rowCount: z.int().min(1).max(100),
  seatsPerRow: z.int().min(1).max(500),
  isGa: z.boolean().default(false),
  // Seating-unit kind, drives generated labels (see generate-architecture).
  // Optional for back-compat; the generator infers "ga"/"rows" from isGa
  // when absent.
  unitType: z.enum(["rows", "tables", "boxes", "ga", "custom"]).optional(),
  // Singular label for unitType "custom" (e.g. "Lawn"). Required only then.
  customLabel: z.string().min(1).max(40).optional(),
});

const CreateVenueSchema = z
  .object({
    name: z.string().min(1).max(200),
    city: z.string().min(1).max(120).optional(),
    // Venue centroid for the QR geo-gate. Optional, but lat+lon come as a
    // pair (a lone coordinate is meaningless).
    geoLat: z.number().min(-90).max(90).optional(),
    geoLon: z.number().min(-180).max(180).optional(),
    geoRadiusM: z.int().positive().max(100_000).default(500),
    tiers: z.array(TierSpecSchema).min(1).max(20),
  })
  .superRefine((d, ctx) => {
    const names = d.tiers.map((t) => t.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: "custom",
        path: ["tiers"],
        message: "tier names must be unique",
      });
    }
    if ((d.geoLat === undefined) !== (d.geoLon === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["geoLat"],
        message: "geoLat and geoLon must be provided together",
      });
    }
    d.tiers.forEach((t, i) => {
      if (t.unitType === "custom" && !t.customLabel?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", i, "customLabel"],
          message: "a custom unit type needs a label",
        });
      }
    });
  });

type CreatedRow = {
  id: string;
  area: string;
  section: string;
  rowName: string;
  tier: string | null;
  capacity: number;
};

type CreateVenueResponse = {
  ok: true;
  venueId: string;
  architectureId: string;
  rows: CreatedRow[];
};
type ErrorBody = { error: string; details?: unknown };

export async function POST(
  request: Request,
): Promise<NextResponse<CreateVenueResponse | ErrorBody>> {
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
  const parsed = CreateVenueSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Authorization: an operator (admin) or anyone who manages at least one
  // artist may create a venue. 403 here (not 404) — there's no specific
  // resource id to keep secret, the caller just lacks the capability.
  const [isAdmin, manageable] = await Promise.all([
    userIsAdmin(db, userId),
    listArtistsManageableByUser(db, userId),
  ]);
  if (!isAdmin && manageable.length === 0) {
    return NextResponse.json(
      { error: "not allowed to create venues" },
      { status: 403 },
    );
  }

  const rows = generateArchitectureRows(body.tiers);

  const venue = await createVenue(db, {
    name: body.name,
    city: body.city ?? null,
    geoLat: body.geoLat ?? null,
    geoLon: body.geoLon ?? null,
    geoRadiusM: body.geoRadiusM,
  });

  const architecture = await createVenueArchitecture(db, {
    venueId: venue.id,
    version: 1,
    rows,
  });

  return NextResponse.json(
    {
      ok: true,
      venueId: venue.id,
      architectureId: architecture.id,
      rows: architecture.rows.map((r) => ({
        id: r.id,
        area: r.area,
        section: r.section,
        rowName: r.rowName,
        tier: r.tier ?? null,
        capacity: r.capacity,
      })),
    },
    { status: 201 },
  );
}
