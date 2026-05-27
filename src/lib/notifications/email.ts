// Resend ops email notification. Wraps the existing sendEmail() helper
// from src/lib/email/client.ts, which already handles the no-op path
// (RESEND_API_KEY absent → warn + return { id: null }).
//
// Errors from sendEmail() are caught here so the caller sees a resolved
// promise. Notifications are best-effort; a Resend failure should never
// surface as an HTTP 5xx on the PATCH /api/artist-requests/[id] route.

import React from "react";

import { sendEmail } from "@/lib/email/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { RequestActionedEmail } from "@/lib/email/templates/RequestActioned";

import type { RequestActionedPayload } from "./index";

export async function emailRequestActioned(
  payload: RequestActionedPayload,
): Promise<void> {
  const subject = `[AUCKETS] ${payload.status === "executed" ? "Executed" : "Denied"}: ${payload.kindLabel} — ${payload.artistName}`;

  try {
    await sendEmail({
      to: env.OPS_EMAIL,
      subject,
      react: React.createElement(RequestActionedEmail, {
        kindLabel: payload.kindLabel,
        status: payload.status,
        executorEmail: payload.executorEmail,
        filerEmail: payload.filerEmail,
        artistName: payload.artistName,
        showContext: payload.showContext,
        executorNotes: payload.executorNotes,
      }),
    });
  } catch (err) {
    logger.warn(
      { event: "notification.email.error", err, requestId: payload.requestId },
      "Ops email notification threw — check Resend configuration",
    );
  }
}
