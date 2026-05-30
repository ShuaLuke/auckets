// Request action button + dialog on the ShowAdmin page. Ports
// design/ui_kits/auckets/screens/ShowAdmin.jsx lines 33-36 (the
// header button) + 403-461 (the dialog). Per ADR-0013: artists file
// requests through this dialog; AUCKETS ops staff execute.
//
// POST /api/artist-requests handles auth + authorization server-side
// (artist members and AUCKETS_ADMIN can file). The button itself
// renders for everyone who reached the ShowAdmin page — they already
// have manage rights, otherwise the page would have 404'd.

"use client";

import { MessageSquare } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";

const KIND_OPTIONS = [
  {
    value: "comp",
    label: "Comp specific guests",
    hint: "Family, press, friends. Provide names + emails.",
  },
  {
    value: "override",
    label: "Override a placement",
    hint: "Move someone, or block someone from being placed.",
  },
  {
    value: "pause",
    label: "Pause offers",
    hint: "Stop accepting new offers immediately.",
  },
  {
    value: "end_early",
    label: "End the offer window early",
    hint: "Run binding allocation now instead of T-24.",
  },
] as const;

type Kind = (typeof KIND_OPTIONS)[number]["value"];

type Props = {
  showId: string;
};

export function RequestActionButton({ showId }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("comp");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);

  function close() {
    if (submitting) return;
    setOpen(false);
    // Clear state on close so the next open starts clean. Keep the
    // submitted details around briefly only via the in-dialog success
    // panel before it auto-closes.
    setError(null);
    setSentId(null);
    setDetails("");
    setKind("comp");
  }

  async function send() {
    if (details.trim().length === 0) {
      setError("Add a bit of detail so ops knows what you need.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/artist-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ showId, kind, details: details.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : null) ?? `Request failed (HTTP ${res.status})`,
        );
        return;
      }
      const created = body as { id: string };
      setSentId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label="Request action"
      >
        <MessageSquare size={14} strokeWidth={2} aria-hidden />
        Request action
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: "rgba(14,15,12,0.4)" }}
          onClick={close}
          role="dialog"
          aria-modal="true"
          aria-labelledby="request-action-title"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-2xl p-7"
            style={{
              width: "min(540px, calc(100vw - 32px))",
              background: "var(--page)",
              boxShadow:
                "0 24px 48px rgba(14,15,12,0.20), 0 0 0 1px var(--border)",
            }}
          >
            <p
              className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[0.16em]"
              style={{ color: "var(--fg-muted)" }}
            >
              Request
            </p>
            <h3
              id="request-action-title"
              className="mb-2 text-[22px]"
              style={{ letterSpacing: "-0.01em" }}
            >
              {sentId ? "Filed with AUCKETS ops." : "Request a change."}
            </h3>

            {sentId ? (
              <p
                className="mb-5 font-sans text-[13px]"
                style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
              >
                Ops typically handles requests within 30 minutes. We&apos;ll
                follow up by email if there are questions. You can close this
                dialog now.
              </p>
            ) : (
              <p
                className="mb-5 font-sans text-[13px]"
                style={{ color: "var(--fg-muted)", lineHeight: 1.55 }}
              >
                Auckets is a managed operator — you tell us what you need, we
                execute and log it. Most requests are handled within 30 minutes.
              </p>
            )}

            {!sentId && (
              <div className="mb-5 flex flex-col gap-4">
                <fieldset className="flex flex-col gap-2">
                  <legend
                    className="mb-1 font-sans text-[11px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    What do you need?
                  </legend>
                  {KIND_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex cursor-pointer items-start gap-3 rounded-lg p-3"
                      style={{
                        border:
                          kind === opt.value
                            ? "1px solid var(--brand)"
                            : "1px solid var(--border)",
                        background:
                          kind === opt.value
                            ? "var(--brand-bg)"
                            : "var(--page)",
                      }}
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={opt.value}
                        checked={kind === opt.value}
                        onChange={() => setKind(opt.value)}
                        className="mt-0.5"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span
                          className="font-sans text-[14px]"
                          style={{ color: "var(--fg)" }}
                        >
                          {opt.label}
                        </span>
                        <span
                          className="font-sans text-[12px]"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {opt.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>

                <label className="flex flex-col gap-1.5">
                  <span
                    className="font-sans text-[11px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    Details
                  </span>
                  <textarea
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Tell us what you need, who's involved, and the deadline."
                    rows={4}
                    maxLength={2000}
                    className="rounded-lg p-3 font-sans text-sm"
                    style={{
                      background: "var(--page)",
                      color: "var(--fg)",
                      border: "1px solid var(--border-strong)",
                      outline: "none",
                      resize: "vertical",
                      minHeight: 90,
                    }}
                  />
                </label>
              </div>
            )}

            {error && (
              <div
                className="mb-5 rounded-lg p-3 font-sans text-[13px]"
                style={{
                  background: "#F2D9D3",
                  color: "#722417",
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}

            {sentId && (
              <div
                className="mb-5 rounded-lg p-3 font-mono text-[11px]"
                style={{
                  background: "var(--paper)",
                  color: "var(--ink-700)",
                  lineHeight: 1.65,
                }}
              >
                <div>request_id={sentId}</div>
                <div>status=open</div>
                <div>routes_to=ops@auckets.com + #ops-{showId.slice(-4)}</div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close} disabled={submitting}>
                {sentId ? "Close" : "Cancel"}
              </Button>
              {!sentId && (
                <Button
                  variant="brand"
                  onClick={send}
                  disabled={submitting}
                >
                  {submitting ? "Sending…" : "Send to Auckets ops"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
