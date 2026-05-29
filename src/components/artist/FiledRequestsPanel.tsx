// "Filed requests" panel on ShowAdmin. Closes PERSONAS.md artist #3:
// before this, an artist filed a pause/comp/override request (ADR-0013)
// and it vanished — no in-app record, no status, the only feedback was
// the (dormant) RequestActioned email. This surfaces every request filed
// against the show with its current status (open / executed / denied)
// and any ops notes, so filing isn't a void.
//
// Read-only server component. The filing action lives in the header's
// RequestActionButton; execution lives in the admin inbox. This is just
// the artist-facing mirror.

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { ArtistRequestStatusView } from "@/lib/presenters";

const STATUS_TONE: Record<ArtistRequestStatusView["status"], BadgeTone> = {
  open: "preview",
  executed: "placed",
  denied: "unplaced",
};

const STATUS_LABEL: Record<ArtistRequestStatusView["status"], string> = {
  open: "Awaiting ops",
  executed: "Executed",
  denied: "Denied",
};

export function FiledRequestsPanel({
  requests,
}: {
  requests: readonly ArtistRequestStatusView[];
}) {
  if (requests.length === 0) return null;

  return (
    <Card className="mb-6" style={{ padding: 20 }}>
      <Eyebrow className="mb-3">Filed requests</Eyebrow>
      <div className="flex flex-col gap-2.5">
        {requests.map((r) => (
          <div
            key={r.id}
            className="rounded-lg p-3"
            style={{ background: "var(--paper)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="font-sans text-[13px] font-medium"
                  style={{ color: "var(--ink-900)" }}
                >
                  {r.kindLabel}
                </div>
                {r.details && (
                  <div
                    className="mt-0.5 font-sans text-xs"
                    style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}
                  >
                    {r.details}
                  </div>
                )}
              </div>
              <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            </div>

            <div
              className="mt-1.5 font-sans text-[11px]"
              style={{ color: "var(--fg-subtle)" }}
            >
              Filed {r.filedTimeAgo}
              {r.resolution && (
                <>
                  {" · "}
                  {r.resolution.status === "executed" ? "executed" : "denied"}{" "}
                  {r.resolution.timeAgo}
                </>
              )}
            </div>

            {r.resolution?.notes && (
              <div
                className="mt-2 rounded p-2 font-sans text-[11px]"
                style={{
                  background: "var(--paper-2)",
                  color: "var(--fg-muted)",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: "var(--fg)" }}>Ops note:</span>{" "}
                {r.resolution.notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
