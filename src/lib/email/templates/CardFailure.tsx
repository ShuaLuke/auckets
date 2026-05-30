// Fan email: the card couldn't be charged when the group was placed. The seat
// is held for a short recovery window during which the fan can add a working
// card. Props are pre-formatted strings — no DB types.

import {
  FanCta,
  FanEmailShell,
  FanHeading,
  FanText,
  ShowSummaryLine,
} from "./_FanEmailShell";

export type CardFailureEmailProps = {
  artistName: string;
  showName: string;
  dateLong: string;
  // E.g. "within 4 hours" — how long the seat is held. Pre-formatted.
  windowLine: string;
  // Link to the Show page where the card-recovery modal lives.
  recoverUrl: string;
};

export function CardFailureEmail({
  artistName,
  showName,
  dateLong,
  windowLine,
  recoverUrl,
}: CardFailureEmailProps) {
  return (
    <FanEmailShell preview={`Action needed — ${showName}`}>
      <FanHeading>Your card didn&apos;t go through.</FanHeading>
      <ShowSummaryLine
        artistName={artistName}
        showName={showName}
        dateLong={dateLong}
      />
      <FanText>
        Good news: your group was placed. But we couldn&apos;t charge your card,
        so we need a working one to lock in your seats.
      </FanText>
      <FanText>
        We&apos;re holding your seats <strong>{windowLine}</strong>. Add a card
        before then or the seats are released to other fans.
      </FanText>
      <FanCta href={recoverUrl} label="Add a working card" />
    </FanEmailShell>
  );
}

export default CardFailureEmail;
