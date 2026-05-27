// Slack ops channel notification via an incoming webhook. No SDK —
// incoming webhooks are a single POST with a JSON body. The webhook
// URL encodes the channel and auth; the URL itself is the credential.
//
// No-ops when SLACK_OPS_WEBHOOK_URL is unset, matching the Resend
// dormant-mode pattern. Errors are caught and logged rather than
// re-thrown so callers (notifyRequestActioned) see a resolved promise
// even on Slack failure — notifications are best-effort.

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import type { RequestActionedPayload } from "./index";

function buildSlackText(payload: RequestActionedPayload): string {
  const statusEmoji = payload.status === "executed" ? "✅" : "🚫";
  const statusLabel = payload.status === "executed" ? "Executed" : "Denied";
  const lines = [
    `${statusEmoji} *${payload.kindLabel}* request *${statusLabel}*`,
    `*Artist:* ${payload.artistName}`,
    `*Show:* ${payload.showContext}`,
    `*Filed by:* ${payload.filerEmail}`,
    `*Actioned by:* ${payload.executorEmail}`,
  ];
  if (payload.executorNotes) {
    lines.push(`*Notes:* ${payload.executorNotes}`);
  }
  return lines.join("\n");
}

export async function postRequestActioned(
  payload: RequestActionedPayload,
): Promise<void> {
  if (!env.SLACK_OPS_WEBHOOK_URL) {
    logger.debug(
      { event: "notification.slack.skipped", reason: "no_webhook_url" },
      "SLACK_OPS_WEBHOOK_URL not set — Slack notification skipped",
    );
    return;
  }

  try {
    const res = await fetch(env.SLACK_OPS_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: buildSlackText(payload) }),
    });
    if (!res.ok) {
      logger.warn(
        {
          event: "notification.slack.failed",
          status: res.status,
          requestId: payload.requestId,
        },
        "Slack webhook returned non-2xx — check channel configuration",
      );
    }
  } catch (err) {
    logger.warn(
      { event: "notification.slack.error", err, requestId: payload.requestId },
      "Slack webhook call threw — check network connectivity",
    );
  }
}
