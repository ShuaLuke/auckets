// Trash-icon button on the Holds card. Inline two-step confirm
// instead of a global modal — the row stays visible while the user
// commits. DELETE /api/holds/[id] handles authorization based on
// hold.kind (artist-kind: member or admin; venue-kind: admin only),
// so this component just calls and refreshes.

"use client";

import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  holdId: string;
  // Short label for the aria description so screen readers know what's
  // being deleted ("Remove hold for Row F · seats 5-8").
  description: string;
};

export function DeleteHoldButton({ holdId, description }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/holds/${holdId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        setError(
          (data && typeof data === "object" && "error" in data
            ? String(data.error)
            : null) ?? `Delete failed (HTTP ${res.status})`,
        );
        return;
      }
      router.refresh();
      // The row will disappear when the page re-renders; leaving
      // confirming=true would briefly show a stale state.
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    // Keep the error inline so the user can retry without losing
    // their place. Click the X to dismiss.
    return (
      <div className="flex items-center gap-2">
        <span
          className="font-sans text-[11px]"
          style={{ color: "#722417" }}
        >
          {error}
        </span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(false);
          }}
          aria-label="Dismiss error"
          className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent"
          style={{ color: "var(--fg-muted)" }}
        >
          <X size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={submitting}
          className="rounded-md px-2 py-1 font-sans text-[11px]"
          style={{
            background: "transparent",
            color: "var(--fg-muted)",
            border: "1px solid var(--border)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={send}
          disabled={submitting}
          className="rounded-md px-2 py-1 font-sans text-[11px] font-semibold"
          style={{
            background: "#722417",
            color: "var(--paper)",
            border: "1px solid #722417",
          }}
        >
          {submitting ? "Removing…" : "Confirm remove"}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label={`Remove hold (${description})`}
      title="Remove hold"
      className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent"
      style={{ color: "var(--fg-muted)", cursor: "pointer" }}
    >
      <Trash2 size={14} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
