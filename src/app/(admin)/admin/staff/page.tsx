// /admin/staff — the Staff section of the ops command center. Grant or
// revoke the VENUE_STAFF door-scanner role by email (ADR-0012).
//
// Authorization: notFound() on non-admin so the route's existence doesn't
// leak. Same posture as /admin and /admin/requests.

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { StaffRoleForm } from "@/components/admin/StaffRoleForm";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import { userIsAdmin } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

const navInactive: React.CSSProperties = {
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border)",
};
const navActive: React.CSSProperties = {
  background: "var(--ink-900)",
  color: "var(--paper)",
};

export default async function AdminStaffPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!(await userIsAdmin(db, userId))) notFound();

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1100px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">Auckets ops</Eyebrow>
          <h1 className="text-4xl">Staff</h1>
          <p
            className="mt-1 font-sans text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            Who can work the door scanner.
          </p>
        </div>

        <div className="mb-6 flex items-center gap-1">
          <Link
            href="/admin"
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={navInactive}
          >
            Shows
          </Link>
          <Link
            href="/admin/artists"
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={navInactive}
          >
            Artists
          </Link>
          <Link
            href="/admin/requests"
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={navInactive}
          >
            Requests
          </Link>
          <span
            className="rounded-full px-3 py-1.5 font-sans text-[13px]"
            style={navActive}
          >
            Staff
          </span>
        </div>

        <StaffRoleForm />
      </div>
    </main>
  );
}
