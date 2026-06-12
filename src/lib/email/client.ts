import type { ReactElement } from "react";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Resend wrapper. Stays dormant when RESEND_API_KEY is unset — instead of
 * throwing, sendEmail() logs a warning and returns a no-op result. This
 * keeps local dev / CI workable without a real Resend account while still
 * surfacing the gap.
 *
 * Templates live in src/lib/email/templates/. Pass the rendered React
 * component as `react`.
 */

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export type SendEmailArgs = {
  to: string | string[];
  subject: string;
  react: ReactElement;
  from?: string;
};

export async function sendEmail({
  to,
  subject,
  react,
  from,
}: SendEmailArgs): Promise<{ id: string | null }> {
  if (!resend) {
    logger.warn(
      { to, subject },
      "RESEND_API_KEY not set — email not sent (dormant mode)",
    );
    return { id: null };
  }

  // The Resend SDK has no request timeout, and sendEmail is awaited inside
  // request paths (offer submission, artist-request actions) before the
  // response is sent — a hung Resend API would pin those requests until the
  // function is killed. Same family as the DB wedge (#128/#129): every
  // awaited external call gets a client-side deadline. Callers already
  // treat email as best-effort (safeSend / notification wrappers catch),
  // so timing out behaves exactly like any other send failure.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Resend: send timed out after 10000ms")),
      10_000,
    );
  });
  const result = await Promise.race([
    resend.emails.send({
      from: from ?? env.RESEND_FROM_EMAIL,
      to,
      subject,
      react,
    }),
    deadline,
  ]).finally(() => clearTimeout(timer));

  if (result.error) {
    logger.error({ err: result.error, to, subject }, "Resend send failed");
    throw new Error(`Resend: ${result.error.message}`);
  }

  return { id: result.data?.id ?? null };
}
