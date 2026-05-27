// Row component for the /admin/requests inbox. Renders the request
// meta + show context + body, and (for open rows) the execute/deny
// affordances. Each action opens an inline confirmation dialog with
// an optional/required notes textarea and PATCHes
// /api/artist-requests/[id].
//
// Open rows action; executed/denied rows render the outcome inline
// (operator email, when, and notes) and skip the action buttons.

"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

import type { ArtistRequestInboxView } from "@/lib/presenters";

type Action = "execute" | "deny";

type Props = {
  row: ArtistRequestInboxView;
};

export function RequestActionRow({ row }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(next: Action) {
    setAction(next);
    setNotes("");
    setError(null);
  }

  function close() {
    if (submitting) return;
    setAction(null);
    setNotes("");
    setError(null);
  }

  async function send() {
    if (!action) return;
    const trimmed = notes.trim();
    if (action === "deny" && trimmed.length === 0) {
      setError("Notes required when denying — the artist will see this.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: { action: Action; notes?: string } = { action };
      if (trimmed.length > 0) body.notes = trimmed;
      const res = await fetch(`/api/artist-requests/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        setError(
          (data && typeof data === "object" && "error" in data
            ? String(data.error)
            : null) ?? `Action failed (HTTP ${res.status})`,
        );
        return;
      }
      // Server data changed → re-fetch the page. The row will move
      // from the open tab to the executed/denied tab on next render.
      router.refresh();
      setAction(null);
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const isOpen = row.status === "open";

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className="font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--fg-muted)" }}
            >
              {row.kindLabel}
            </span>
            {row.status === "open" && <Badge tone="open">Open</Badge>}
            {row.status === "executed" && <Badge tone="placed">Executed</Badge>}
            {row.status === "denied" && <Badge tone="unplaced">Denied</Badge>}
          </div>
          <p
            className="font-sans text-[14px]"
            style={{ color: "var(--fg)", lineHeight: 1.5 }}
          >
            {row.showContext}
          </p>
          <p
            className="font-sans text-[12px]"
            style={{ color: "var(--fg-muted)" }}
          >
            Filed by {row.filerEmail} · {row.filedTimeAgo} ·{" "}
            <span className="font-mono tabular-nums">{row.filedDisplay}</span>
          </p>
        </div>
        <a
          href={`/artists/${row.artistId}/shows/${row.showId}`}
          className="font-sans text-[12px] underline"
          style={{ color: "var(--fg-muted)" }}
        >
          Open show ↗
        </a>
      </div>

      <div
        className="mb-3 rounded-lg p-3 font-sans text-[13px]"
        style={{
          background: "var(--paper-2)",
          color: "var(--ink-700)",
          lineHeight: 1.55,
          whiteSpace: "pre-wrap",
        }}
      >
        {row.details}
      </div>

      {row.executor && (
        <div
          className="mb-3 rounded-lg p-3 font-mono text-[11px]"
          style={{
            background: "var(--paper)",
            color: "var(--ink-700)",
            lineHeight: 1.65,
          }}
        >
          <div>
            {row.status === "executed" ? "executed_by" : "denied_by"}=
            {row.executor.email}
          </div>
          <div>
            at={row.executor.display} · {row.executor.timeAgo}
          </div>
          {row.executor.notes && <div>notes={row.executor.notes}</div>}
        </div>
      )}

      {isOpen && (
        <>
          {action === null ? (
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => open("deny")}
                aria-label="Deny request"
              >
                <X size={14} strokeWidth={2} aria-hidden />
                Deny
              </Button>
              <Button
                variant="brand"
                onClick={() => open("execute")}
                aria-label="Mark request executed"
              >
                <Check size={14} strokeWidth={2} aria-hidden />
                Mark executed
              </Button>
            </div>
          ) : (
            <div
              className="rounded-lg p-3"
              style={{
                background: "var(--paper-2)",
                border: "1px solid var(--border)",
              }}
            >
              <p
                className="mb-2 font-sans text-[12px]"
                style={{ color: "var(--fg-muted)" }}
              >
                {action === "execute"
                  ? "Optional notes — what you did (e.g. 'Comped row F seats 5-8')."
                  : "Required notes — why you're denying. The artist will see this."}
              </p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  action === "execute"
                    ? "Comped row F seats 5-8."
                    : "Can't comp inside the binding window — please refile after T-24."
                }
                rows={3}
                maxLength={2000}
                className="mb-2 w-full rounded-lg p-2 font-sans text-[13px]"
                style={{
                  background: "var(--page)",
                  color: "var(--fg)",
                  border: "1px solid var(--border-strong)",
                  outline: "none",
                  resize: "vertical",
                  minHeight: 60,
                }}
              />
              {error && (
                <div
                  className="mb-2 rounded p-2 font-sans text-[12px]"
                  style={{
                    background: "#F2D9D3",
                    color: "#722417",
                    lineHeight: 1.5,
                  }}
                >
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={close} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  variant={action === "execute" ? "brand" : "secondary"}
                  onClick={send}
                  disabled={submitting}
                >
                  {submitting
                    ? "Sending…"
                    : action === "execute"
                      ? "Confirm execute"
                      : "Confirm deny"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
