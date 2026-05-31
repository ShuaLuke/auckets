// Fan email: a reminder that binding allocation is coming up, so the fan can
// revise upward before the window closes. Props are pre-formatted strings.

import {
  FanCta,
  FanEmailShell,
  FanHeading,
  FanText,
  ShowSummaryLine,
} from "./_FanEmailShell";

export type AllocationImminentEmailProps = {
  artistName: string;
  showName: string;
  dateLong: string;
  // E.g. "tomorrow at 6:00 PM CT" — when binding runs. Pre-formatted.
  whenLine: string;
  showUrl: string;
};

export function AllocationImminentEmail({
  artistName,
  showName,
  dateLong,
  whenLine,
  showUrl,
}: AllocationImminentEmailProps) {
  return (
    <FanEmailShell preview={`Allocation soon — ${showName}`}>
      <FanHeading>Allocation is coming up.</FanHeading>
      <ShowSummaryLine
        artistName={artistName}
        showName={showName}
        dateLong={dateLong}
      />
      <FanText>
        Seats for this show are decided <strong>{whenLine}</strong>. This is your
        last chance to revise your offer upward — once allocation runs, offers
        are final and placed cards are charged.
      </FanText>
      <FanText>
        Check where you&apos;d land right now and adjust if you want a better
        shot.
      </FanText>
      <FanCta href={showUrl} label="Review your offer" />
    </FanEmailShell>
  );
}

export default AllocationImminentEmail;
