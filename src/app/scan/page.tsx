// /scan — the door-staff Scanner (ADR-0015 / ADR-0012). Server-gated to
// VENUE_STAFF / AUCKETS_ADMIN; notFound() for everyone else so the route's
// existence isn't revealed to fans. The interactive scanning lives in the
// Scanner client component, which posts tokens to /api/scan.

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import { Scanner } from "@/components/scan/Scanner";
import { db } from "@/lib/db";
import { userCanScan } from "@/lib/db/repositories";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const allowed = await userCanScan(db, userId);
  if (!allowed) notFound();

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto px-6 pb-16 pt-8" style={{ maxWidth: 560 }}>
        <h1
          className="font-sans"
          style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}
        >
          Door scanner
        </h1>
        <p
          className="font-sans"
          style={{ fontSize: 13, color: "var(--fg-muted)", marginBottom: 20 }}
        >
          Point the camera at a fan&apos;s rotating QR, or paste the token.
        </p>
        <Scanner />
      </div>
    </main>
  );
}
