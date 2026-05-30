// /admin/requests — AUCKETS_ADMIN-only inbox where ops execute or
// deny the requests artists file via the ShowAdmin "Request action"
// dialog. Per ADR-0013, this page is the operator side of that
// workflow.
//
// Authorization posture: notFound() on non-admin so the route's
// existence doesn't leak to a fan / artist who guesses the URL.
// Mirrors the (artist) route group's posture.
//
// Tab strip switches between open / executed / denied via ?status=.
// Default is "open" — the FIFO queue of work to do. Each row in the
// list expands inline to show details + action buttons (execute / deny)
// handled by the RequestActionRow client component.

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { RequestActionRow } from "@/components/admin/RequestActionRow";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { db } from "@/lib/db";
import {
  ARTIST_REQUEST_STATUSES,
  getEmailsByUserIds,
  listArtistRequestsForAdminInbox,
  userIsAdmin,
  type ArtistRequestStatus,
} from "@/lib/db/repositories";
import {
  DEFAULT_TZ,
  presentArtistRequestInboxRow,
  type ArtistRequestInboxView,
} from "@/lib/presenters";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: { status?: string };
};

function parseStatus(raw: string | undefined): ArtistRequestStatus {
  if (
    raw === "open" ||
    raw === "executed" ||
    raw === "denied"
  ) {
    return raw;
  }
  return "open";
}

async function presentInboxRows(
  rows: Awaited<ReturnType<typeof listArtistRequestsForAdminInbox>>,
): Promise<ArtistRequestInboxView[]> {
  const executorIds = Array.from(
    new Set(rows.map((r) => r.executedBy).filter((v): v is string => v !== null)),
  );
  // One batched lookup for the actioned-row executor emails — open
  // rows skip the lookup entirely since their executor is always null.
  const executorEmails = await getEmailsByUserIds(db, executorIds);
  const now = new Date();
  return rows.map((row) =>
    presentArtistRequestInboxRow(
      row,
      row.executedBy ? (executorEmails.get(row.executedBy) ?? null) : null,
      now,
      DEFAULT_TZ,
    ),
  );
}

export default async function AdminRequestsPage({ searchParams }: Props) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // 404 over 403: the route doesn't exist as far as non-admins are
  // concerned. Same posture as the (artist) routes.
  const allowed = await userIsAdmin(db, userId);
  if (!allowed) notFound();

  const status = parseStatus(searchParams?.status);

  // Per-tab counts: cheap parallel queries. The numbers anchor the tab
  // labels so ops can see at a glance whether anything is waiting.
  // Includes the currently-shown tab's rows so we don't query twice.
  const [openRows, executedRows, deniedRows] = await Promise.all([
    listArtistRequestsForAdminInbox(db, "open"),
    listArtistRequestsForAdminInbox(db, "executed"),
    listArtistRequestsForAdminInbox(db, "denied"),
  ]);
  const counts: Record<ArtistRequestStatus, number> = {
    open: openRows.length,
    executed: executedRows.length,
    denied: deniedRows.length,
  };

  const rowsForStatus =
    status === "open"
      ? openRows
      : status === "executed"
        ? executedRows
        : deniedRows;
  const rows = await presentInboxRows(rowsForStatus);

  return (
    <main
      className="min-h-[calc(100vh-57px)]"
      style={{ background: "var(--paper)" }}
    >
      <div className="mx-auto max-w-[1000px] px-4 py-12 md:px-8">
        <div className="mb-7">
          <Eyebrow className="mb-2">Auckets ops</Eyebrow>
          <h1 className="text-4xl">Artist requests</h1>
          <p
            className="mt-1 font-sans text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            Comp guests, override placements, pause offers, end the window
            early. Filed by artists from their show page, executed here.
          </p>
        </div>

        <div className="mb-6 flex items-center gap-1">
          {ARTIST_REQUEST_STATUSES.map((s) => {
            const active = s === status;
            return (
              <Link
                key={s}
                href={s === "open" ? "/admin/requests" : `/admin/requests?status=${s}`}
                className="rounded-full px-3 py-1.5 font-sans text-[13px] capitalize"
                style={{
                  background: active ? "var(--ink-900)" : "transparent",
                  color: active ? "var(--paper)" : "var(--fg-muted)",
                  border: active ? "0" : "1px solid var(--border)",
                }}
              >
                {s} <span className="tabular-nums">· {counts[s]}</span>
              </Link>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div
            className="rounded-xl p-5 font-sans text-[13px]"
            style={{
              background: "var(--paper-2)",
              color: "var(--fg-muted)",
              lineHeight: 1.55,
            }}
          >
            {status === "open"
              ? "Inbox zero — no open requests right now."
              : `No ${status} requests yet.`}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <RequestActionRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
