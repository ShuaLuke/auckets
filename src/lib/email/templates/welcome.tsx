// Fan email: first touch after account creation. Rebuilt in the UI-3 copy
// pack on the shared fan shell (it was an unstyled system-ui placeholder)
// so the very first email a fan gets already looks and sounds like AUCKETS.
//
// Props are pre-formatted strings — no DB types. No sender is wired yet
// (the Clerk-signup hook is future work); when one lands, it builds
// `showsUrl` from env.NEXT_PUBLIC_APP_URL the way fan.ts does.

import { FanCta, FanEmailShell, FanHeading, FanText } from "./_FanEmailShell";

export type WelcomeEmailProps = {
  name: string;
  // Link to the public lineup (/shows). Pre-built by the caller.
  showsUrl: string;
};

export function WelcomeEmail({ name, showsUrl }: WelcomeEmailProps) {
  return (
    <FanEmailShell
      preview="Welcome to AUCKETS — one offer, your people seated together."
      footerNote="AUCKETS — not an auction. You're receiving this because you just created an account. Please don't reply to this address."
    >
      <FanHeading>Welcome, {name}.</FanHeading>
      <FanText>
        AUCKETS works a little differently from the ticket sites you know.
        When an artist opens a show, you make one offer — your price, your
        group size. When the window closes, every offer in the room is ranked
        and groups are seated together, best section first.
      </FanText>
      <FanText>
        Nothing to refresh, nothing to race. You&apos;re only ever charged if
        you&apos;re seated — and never a penny in fees.
      </FanText>
      <FanCta href={showsUrl} label="See the lineup" />
    </FanEmailShell>
  );
}

export default WelcomeEmail;
