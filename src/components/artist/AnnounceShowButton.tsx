// "Announce" button on the ShowAdmin header, shown only for a draft show.
// Announcing transitions the show 'draft' → 'open': it becomes visible to
// fans on /shows and /dashboard, accepts offers, and will bind on schedule.
//
// Opening an offer window is a deliberate, hard-to-undo step (a fan who sees
// an open show may submit and authorize a card), so the button confirms once
// before firing. It's lighter-touch than BindingAllocationButton's type-to-
// confirm — announcing doesn't move money — but it's not a bare one-click.
//
// The server route (POST /api/shows/[showId]/announce) is the authoritative
// authorization + status check; this component only renders for a draft show
// the page already confirmed the viewer can manage.

"use client";

import { Megaphone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";

type Props = {
  showId: string;
};

export function AnnounceShowButton({ showId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (running) return;
    setOpen(false);
    setError(null);
  }

  async function run() {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/shows/${showId}/announce`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : null) ?? `Announce failed (HTTP ${res.status})`,
        );
        return;
      }
      // Success: the show is now open. Refresh so the status banner, badge,
      // and (now-hidden) Announce button reflect the new state.
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        aria-label="Announce show"
      >
        <Megaphone size={14} strokeWidth={1.75} aria-hidden />
        Announce
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(14,15,12,0.4)" }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="announce-show-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-2xl p-7"
            style={{
              width: "min(480px, calc(100vw - 32px))",
              background: "var(--page)",
              boxShadow:
                "0 24px 48px rgba(14,15,12,0.20), 0 0 0 1px var(--border)",
            }}
          >
            <p
              className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--fg-muted)" }}
            >
              Announce show
            </p>
            <h3
              id="announce-show-title"
              className="mb-3 text-[22px]"
              style={{ letterSpacing: "-0.01em" }}
            >
              Open this show to fans?
            </h3>

            <div
              className="mb-5 font-sans text-[13px]"
              style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
            >
              <p className="mb-2">Announcing will:</p>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                <li>List the show publicly on the lineup and fan dashboard.</li>
                <li>Open the offer window — fans can submit and revise offers.</li>
                <li>
                  Let binding run automatically at the scheduled allocation
                  time.
                </li>
              </ul>
              <p className="mt-2">
                You can still pause the show afterward, but the offer window
                will have opened.
              </p>
            </div>

            {error && (
              <div
                className="mb-5 rounded-lg p-3 font-sans text-[13px]"
                style={{
                  background: "var(--brick-100)",
                  color: "var(--brick-700)",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={running}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={run}
                disabled={running}
                aria-label="Confirm announce show"
              >
                <Megaphone size={14} strokeWidth={1.75} aria-hidden />
                {running ? "Announcing…" : "Announce show"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
