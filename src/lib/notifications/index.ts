// Ops notification dispatcher for artist-request actions. Fires both
// Slack and email in parallel via Promise.allSettled so a failure in
// one channel never blocks the other.
//
// Both channels are best-effort:
//   - slack.ts wraps errors and returns void; SLACK_OPS_WEBHOOK_URL
//     absent → silent debug log.
//   - email.ts wraps sendEmail() errors; RESEND_API_KEY absent →
//     sendEmail() warns and no-ops.
//
// The dispatcher logs any unexpected rejections (shouldn't happen —
// each module catches its own) and then returns, so callers never
// need a try/catch around notifyRequestActioned.
//
// Call sites: PATCH /api/artist-requests/[id] after a successful
// execute or deny.

import { logger } from "@/lib/logger";

import { emailRequestActioned } from "./email";
import { postRequestActioned } from "./slack";

// Self-contained payload type — no DB types, no repository imports.
// Callers project what they need from the DB before calling here.
export type RequestActionedPayload = {
  requestId: string;
  // Human-readable label for the request kind.
  // E.g. "Comp", "Pause show", "Resume show" — caller derives this
  // from the raw kind string rather than having notifications import
  // the repo enum.
  kindLabel: string;
  status: "executed" | "denied";
  executorNotes: string | null;
  executorEmail: string;
  filerEmail: string;
  artistName: string;
  // E.g. "The Ryman Auditorium · Nashville" — venue name + city,
  // pre-formatted by the caller so this module stays pure.
  showContext: string;
};

export async function notifyRequestActioned(
  payload: RequestActionedPayload,
): Promise<void> {
  const results = await Promise.allSettled([
    postRequestActioned(payload),
    emailRequestActioned(payload),
  ]);
  for (const result of results) {
    if (result.status === "rejected") {
      // Each channel module catches its own errors; a rejection here
      // means something unexpected slipped through. Log loudly.
      logger.error(
        {
          event: "notification.dispatch.unexpected_rejection",
          err: result.reason,
          requestId: payload.requestId,
        },
        "Notification channel rejected unexpectedly",
      );
    }
  }
}

// Kind → human-readable label. Keeps the label derivation co-located
// with the caller that maps raw DB kind → notification payload.
// Exported so the PATCH route can import it without duplicating the
// mapping.
export const KIND_LABELS: Record<string, string> = {
  comp: "Comp",
  pause: "Pause show",
  resume: "Resume show",
  end_early: "End early",
  other: "Other",
};
