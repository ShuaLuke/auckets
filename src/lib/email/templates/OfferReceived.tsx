// Fan email: confirmation that an offer was received (first submission).
// Props are pre-formatted strings — no DB types.

import {
  FanCta,
  FanEmailShell,
  FanHeading,
  FanText,
  ShowSummaryLine,
} from "./_FanEmailShell";

export type OfferReceivedEmailProps = {
  artistName: string;
  showName: string;
  dateLong: string;
  // E.g. "$30 × 2 = $60". Pre-formatted by the caller.
  offerLine: string;
  showUrl: string;
};

export function OfferReceivedEmail({
  artistName,
  showName,
  dateLong,
  offerLine,
  showUrl,
}: OfferReceivedEmailProps) {
  return (
    <FanEmailShell preview={`Offer received — ${showName}`}>
      <FanHeading>Your offer is in.</FanHeading>
      <ShowSummaryLine
        artistName={artistName}
        showName={showName}
        dateLong={dateLong}
      />
      <FanText>
        We&apos;ve received your offer of <strong>{offerLine}</strong>. There&apos;s
        no auction and no countdown — when the offer window closes, we rank
        every offer and seat groups together, best section first.
      </FanText>
      <FanText>
        You can raise your offer any time before seats are decided. We&apos;ll
        email you the moment they are.
      </FanText>
      <FanCta href={showUrl} label="View your offer" />
    </FanEmailShell>
  );
}

export default OfferReceivedEmail;
