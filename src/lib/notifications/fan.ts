// Fan-facing email dispatch. One best-effort sender per lifecycle event,
// mirroring the ops RequestActioned pattern: each catches its own errors and
// returns void, so callers never need a try/catch and a mail failure never
// breaks the request/allocation that triggered it. sendEmail() itself no-ops
// when RESEND_API_KEY is unset (dormant mode), so these are safe to call in
// dev / CI / before the Resend domain is verified.
//
// Formatting (money, dates, URLs) lives here so the hook sites stay thin and
// the templates receive plain strings.

import type { Db } from "@/lib/db";
import { getEmailsByUserIds } from "@/lib/db/repositories";
import { sendEmail } from "@/lib/email/client";
import { AllocationImminentEmail } from "@/lib/email/templates/AllocationImminent";
import { CardFailureEmail } from "@/lib/email/templates/CardFailure";
import { OfferNotPlacedEmail } from "@/lib/email/templates/OfferNotPlaced";
import { OfferPlacedEmail } from "@/lib/email/templates/OfferPlaced";
import { OfferReceivedEmail } from "@/lib/email/templates/OfferReceived";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";
import { DEFAULT_TZ } from "@/lib/presenters";

// The minimal show identity every fan email needs. Callers build this cheaply
// from a show row (getShowById gives artist.name / venue.name / doorsAt).
export type ShowEmailContext = {
  showId: string;
  artistName: string;
  // Venue name — the headline line in the email.
  showName: string;
  doorsAt: Date;
};

const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
const showUrl = (showId: string) => `${base}/shows/${showId}`;
const ticketUrl = (showId: string) => `${base}/tickets/${showId}`;

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: DEFAULT_TZ,
});

function formatDateLong(d: Date): string {
  return dateFmt.format(d);
}

// Run a sender best-effort: log + swallow so a mail failure never propagates
// into the caller's request or allocation run.
async function safeSend(
  label: string,
  meta: Record<string, unknown>,
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error(
      { event: `notification.fan.${label}.failed`, err, ...meta },
      `Fan email "${label}" failed to send`,
    );
  }
}

export async function notifyOfferReceived(
  ctx: ShowEmailContext,
  args: { to: string; pricePerTicketCents: number; groupSize: number },
): Promise<void> {
  const total = args.pricePerTicketCents * args.groupSize;
  const offerLine = `${formatCents(args.pricePerTicketCents)} × ${args.groupSize} = ${formatCents(total)}`;
  await safeSend("offer_received", { showId: ctx.showId, to: args.to }, () =>
    sendEmail({
      to: args.to,
      subject: `Offer received — ${ctx.showName}`,
      react: OfferReceivedEmail({
        artistName: ctx.artistName,
        showName: ctx.showName,
        dateLong: formatDateLong(ctx.doorsAt),
        offerLine,
        showUrl: showUrl(ctx.showId),
      }),
    }),
  );
}

export async function notifyOfferPlaced(
  ctx: ShowEmailContext,
  args: { to: string; tierLabel: string; chargedAmountCents: number },
): Promise<void> {
  await safeSend("offer_placed", { showId: ctx.showId, to: args.to }, () =>
    sendEmail({
      to: args.to,
      subject: `You're in — ${ctx.showName}`,
      react: OfferPlacedEmail({
        artistName: ctx.artistName,
        showName: ctx.showName,
        dateLong: formatDateLong(ctx.doorsAt),
        tierLabel: args.tierLabel,
        chargedLine: formatCents(args.chargedAmountCents),
        ticketUrl: ticketUrl(ctx.showId),
      }),
    }),
  );
}

export async function notifyOfferNotPlaced(
  ctx: ShowEmailContext,
  args: { to: string },
): Promise<void> {
  await safeSend("offer_not_placed", { showId: ctx.showId, to: args.to }, () =>
    sendEmail({
      to: args.to,
      // Matches the template's preview line — "allocation" is forbidden
      // fan-facing vocabulary (PR #107 fixed the preview, missed the subject).
      subject: `How ${ctx.showName} landed`,
      react: OfferNotPlacedEmail({
        artistName: ctx.artistName,
        showName: ctx.showName,
        dateLong: formatDateLong(ctx.doorsAt),
        showUrl: showUrl(ctx.showId),
      }),
    }),
  );
}

export async function notifyCardFailure(
  ctx: ShowEmailContext,
  args: { to: string },
): Promise<void> {
  await safeSend("card_failure", { showId: ctx.showId, to: args.to }, () =>
    sendEmail({
      to: args.to,
      subject: `Action needed — your card for ${ctx.showName}`,
      react: CardFailureEmail({
        artistName: ctx.artistName,
        showName: ctx.showName,
        dateLong: formatDateLong(ctx.doorsAt),
        // The recovery window is ~4h (ADR-0003 / card-failure-expiry cron).
        windowLine: "for about 4 hours",
        recoverUrl: showUrl(ctx.showId),
      }),
    }),
  );
}

export async function notifyAllocationImminent(
  ctx: ShowEmailContext,
  args: { to: string; bindingAt: Date },
): Promise<void> {
  await safeSend(
    "allocation_imminent",
    { showId: ctx.showId, to: args.to },
    () =>
      sendEmail({
        to: args.to,
        // Matches the template's preview line — "allocation" is forbidden
        // fan-facing vocabulary (PR #107 fixed the preview, missed the subject).
        subject: `Seats decided soon — ${ctx.showName}`,
        react: AllocationImminentEmail({
          artistName: ctx.artistName,
          showName: ctx.showName,
          dateLong: formatDateLong(ctx.doorsAt),
          whenLine: `on ${formatDateLong(args.bindingAt)}`,
          showUrl: showUrl(ctx.showId),
        }),
      }),
  );
}

// Outcome of one offer at binding, projected for notification.
export type BindingOutcomeOffer = {
  userId: string;
  tier: string;
  chargedAmountCents: number;
};

// Fan-out the placed / not-placed / card-failure emails after a binding run.
// Resolves each fan's email in one batched query, then sends best-effort and
// concurrently. Called from runBindingAllocation post-commit.
export async function notifyBindingOutcomes(
  db: Db,
  params: {
    ctx: ShowEmailContext;
    placed: BindingOutcomeOffer[];
    cardFailed: { userId: string }[];
    unplaced: { userId: string }[];
  },
): Promise<void> {
  const userIds = [
    ...params.placed.map((o) => o.userId),
    ...params.cardFailed.map((o) => o.userId),
    ...params.unplaced.map((o) => o.userId),
  ];
  if (userIds.length === 0) return;
  const emailByUser = await getEmailsByUserIds(db, userIds);

  const sends: Promise<void>[] = [];
  for (const o of params.placed) {
    const to = emailByUser.get(o.userId);
    if (to) {
      sends.push(
        notifyOfferPlaced(params.ctx, {
          to,
          tierLabel: o.tier,
          chargedAmountCents: o.chargedAmountCents,
        }),
      );
    }
  }
  for (const o of params.cardFailed) {
    const to = emailByUser.get(o.userId);
    if (to) sends.push(notifyCardFailure(params.ctx, { to }));
  }
  for (const o of params.unplaced) {
    const to = emailByUser.get(o.userId);
    if (to) sends.push(notifyOfferNotPlaced(params.ctx, { to }));
  }
  await Promise.all(sends);
}
