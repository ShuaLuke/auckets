// Fan email: the offer was not placed at binding. The card auth is released;
// the fan pays nothing. Props are pre-formatted strings — no DB types.

import {
  FanCta,
  FanEmailShell,
  FanHeading,
  FanText,
  ShowSummaryLine,
} from "./_FanEmailShell";

export type OfferNotPlacedEmailProps = {
  artistName: string;
  showName: string;
  dateLong: string;
  showUrl: string;
};

export function OfferNotPlacedEmail({
  artistName,
  showName,
  dateLong,
  showUrl,
}: OfferNotPlacedEmailProps) {
  return (
    <FanEmailShell preview={`How ${showName} landed`}>
      <FanHeading>This one didn&apos;t land.</FanHeading>
      <ShowSummaryLine
        artistName={artistName}
        showName={showName}
        dateLong={dateLong}
      />
      <FanText>
        There were more competitive offers than seats this time, so your group
        wasn&apos;t placed. <strong>You haven&apos;t been charged</strong> — the
        hold on your card has been released.
      </FanText>
      <FanText>
        Thanks for offering fairly. We&apos;ll let you know when {artistName}{" "}
        announces another show.
      </FanText>
      <FanCta href={showUrl} label="See the show" />
    </FanEmailShell>
  );
}

export default OfferNotPlacedEmail;
