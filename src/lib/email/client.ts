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

  const result = await resend.emails.send({
    from: from ?? env.RESEND_FROM_EMAIL,
    to,
    subject,
    react,
  });

  if (result.error) {
    logger.error({ err: result.error, to, subject }, "Resend send failed");
    throw new Error(`Resend: ${result.error.message}`);
  }

  return { id: result.data?.id ?? null };
}
