// Fan email: the offer was placed at binding and the card was charged.
// Props are pre-formatted strings — no DB types.

import {
  FanCta,
  FanEmailShell,
  FanHeading,
  FanText,
  ShowSummaryLine,
} from "./_FanEmailShell";

export type OfferPlacedEmailProps = {
  artistName: string;
  showName: string;
  dateLong: string;
  // E.g. "Orchestra" — the tier the group landed in.
  tierLabel: string;
  // E.g. "$60" — total charged. Pre-formatted by the caller.
  chargedLine: string;
  // Link to the rotating-QR ticket viewer.
  ticketUrl: string;
};

export function OfferPlacedEmail({
  artistName,
  showName,
  dateLong,
  tierLabel,
  chargedLine,
  ticketUrl,
}: OfferPlacedEmailProps) {
  return (
    <FanEmailShell preview={`You're in — ${showName}`}>
      <FanHeading>You&apos;re in. 🎟️</FanHeading>
      <ShowSummaryLine
        artistName={artistName}
        showName={showName}
        dateLong={dateLong}
      />
      <FanText>
        Your group was placed in <strong>{tierLabel}</strong> and your card was
        charged <strong>{chargedLine}</strong>.
      </FanText>
      <FanText>
        Your ticket is a rotating QR code that unlocks near the venue on show
        day — open it from your phone when you arrive. No screenshots, no
        printouts.
      </FanText>
      <FanCta href={ticketUrl} label="View your ticket" />
    </FanEmailShell>
  );
}

export default OfferPlacedEmail;
