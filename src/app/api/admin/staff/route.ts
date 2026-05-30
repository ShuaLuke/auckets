// POST /api/admin/staff — grant or revoke the VENUE_STAFF role by email.
// Backs the /admin Staff control. ADR-0012: VENUE_STAFF works the door
// (the scanner); this is how an operator promotes someone to it.
//
// Flow: auth → authorization (AUCKETS_ADMIN only) → input validation →
// resolve user by email → guardrails → setUserRole.
//
// Guardrails:
//   - Only FAN and VENUE_STAFF are assignable. Admin is granted out-of-band,
//     so this tool can't mint admins.
//   - It refuses to touch a user who is already AUCKETS_ADMIN, so it can't be
//     used to demote an admin either.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import {
  getUserByEmail,
  setUserRole,
  userIsAdmin,
} from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  role: z.enum(["VENUE_STAFF", "FAN"]),
});

type StaffResponse = { ok: true; email: string; role: "VENUE_STAFF" | "FAN" };
type ErrorBody = { error: string; details?: unknown };

export async function POST(
  request: Request,
): Promise<NextResponse<StaffResponse | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // 403 here (not 404): the Staff control already lives behind the admin-only
  // /admin route, so a caller reaching this endpoint without admin is a
  // direct hit, not a leak concern.
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
  const { email, role } = parsed.data;

  const target = await getUserByEmail(db, email);
  if (!target) {
    return NextResponse.json(
      {
        error:
          "no user with that email yet — they need to sign in to AUCKETS at least once first",
      },
      { status: 404 },
    );
  }
  // Never let the staff tool change an admin's role.
  if (target.role === "AUCKETS_ADMIN") {
    return NextResponse.json(
      { error: "that user is an admin; their role can't be changed here" },
      { status: 409 },
    );
  }

  await setUserRole(db, target.id, role);

  return NextResponse.json({ ok: true, email, role }, { status: 200 });
}
