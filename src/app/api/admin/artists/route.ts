// POST /api/admin/artists — create an artist and optionally link its first
// member. Backs the create form on the admin-only /admin/artists roster.
//
// Flow (mirrors /api/admin/staff): auth → AUCKETS_ADMIN gate (403, not 404 —
// the control already lives behind the admin-only /admin route) → Zod body
// parse → resolve the member email (if given) → onboardArtist transaction.
//
// Slug: if `slug` is omitted we derive one from the name (slugify). The
// artists.slug UNIQUE constraint is the real collision guard — onboardArtist
// returns `slug_taken`, which we map to 409 so the form can say "that slug is
// in use".
//
// Member email (the artist user to link):
//   - omitted        → create the artist with no member (link someone later).
//   - given + found  → link them, and bump a plain FAN → ARTIST so they can
//                      actually manage. Never touch an AUCKETS_ADMIN (same
//                      guardrail as the staff route); a VENUE_STAFF / already-
//                      ARTIST member is linked without a role change.
//   - given + missing → 422, create nothing. getUserByEmail only finds users
//                      who've signed into AUCKETS at least once, so we ask the
//                      operator to have them sign in first, then link.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getUserByEmail,
  onboardArtist,
  userIsAdmin,
  type OnboardMember,
} from "@/lib/db/repositories";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9-]+$/;

const BodySchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  slug: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .refine((s) => SLUG_RE.test(s), {
      message: "slug must be lowercase letters, numbers, and hyphens only",
    })
    .optional(),
  memberEmail: z
    .email()
    .transform((e) => e.toLowerCase().trim())
    .optional(),
});

type Success = {
  ok: true;
  artist: { id: string; name: string; slug: string };
  member: { email: string; linked: boolean; roleBumped: boolean } | null;
};
type ErrorBody = { error: string; details?: unknown };

export async function POST(
  request: Request,
): Promise<NextResponse<Success | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await userIsAdmin(db, userId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
  const { name, slug: providedSlug, memberEmail } = parsed.data;

  // Use the given slug, or derive one. A name with no alphanumerics (e.g. all
  // punctuation) derives to "" — reject and ask for an explicit slug.
  const slug = providedSlug ?? slugify(name);
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json(
      { error: "couldn't derive a valid slug from that name — provide one" },
      { status: 400 },
    );
  }

  // Resolve the member BEFORE creating anything, so an unknown email rejects
  // without leaving a dangling artist.
  let member: OnboardMember | undefined;
  if (memberEmail) {
    const target = await getUserByEmail(db, memberEmail);
    if (!target) {
      return NextResponse.json(
        {
          error: `no AUCKETS account for ${memberEmail} yet — ask them to sign in to AUCKETS once, then link them.`,
        },
        { status: 422 },
      );
    }
    member = {
      userId: target.id,
      canManage: true,
      // Bump a plain fan so they can manage; leave admins (and anyone already
      // elevated) untouched.
      bumpToArtist: target.role === "FAN",
    };
  }

  const result = await onboardArtist(db, {
    name,
    slug,
    ...(member ? { member } : {}),
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: `the slug "${slug}" is already in use — pick another` },
      { status: 409 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      artist: {
        id: result.artist.id,
        name: result.artist.name,
        slug: result.artist.slug,
      },
      member: memberEmail
        ? {
            email: memberEmail,
            linked: result.memberLinked,
            roleBumped: result.roleBumped,
          }
        : null,
    },
    { status: 201 },
  );
}
