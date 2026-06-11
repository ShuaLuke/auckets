import { describe, expect, it } from "vitest";

import type { Offer, SeatAssignment } from "@/lib/db/repositories";

import { presentCardFailureRecovery } from "./card-failure";

const NOW = new Date("2026-05-29T12:00:00Z");
const WINDOW = 240; // 4h

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: "offer_1",
    showId: "44444444-4444-4444-4444-444444444444",
    userId: "user_1",
    channel: "market",
    groupSize: 2,
    pricePerTicketCents: 6000,
    tierPreference: "any",
    preferredTier: null,
    rankKey: BigInt(6000 * 1000 + 2),
    autoBidEnabled: false,
    autoBidCapCents: null,
    autoBidIncrementCents: 500,
    privateThresholdCents: null,
    stripePaymentMethodId: "pm",
    stripeSetupIntentId: null,
    stripePaymentIntentId: "pi_old",
    status: "card_failure",
    submittedAt: NOW,
    recoveringAt: null,
    revisedAt: null,
    ...overrides,
  };
}

// minutesAgo → a card_failure_at stamp relative to NOW.
function assignmentFailedMinutesAgo(
  minutesAgo: number | null,
): Pick<SeatAssignment, "cardFailureAt"> {
  return {
    cardFailureAt:
      minutesAgo === null
        ? null
        : new Date(NOW.getTime() - minutesAgo * 60_000),
  };
}

describe("presentCardFailureRecovery", () => {
  it("returns the recovery view for a failed offer inside the window", () => {
    const view = presentCardFailureRecovery(
      makeOffer(),
      assignmentFailedMinutesAgo(60), // 1h ago → 3h left
      NOW,
      WINDOW,
    );
    expect(view).not.toBeNull();
    expect(view?.offerId).toBe("offer_1");
    expect(view?.amountLabel).toBe("$120.00"); // 2 × $60
    expect(view?.minutesLeft).toBe(180);
  });

  it("returns null once the window has elapsed", () => {
    const view = presentCardFailureRecovery(
      makeOffer(),
      assignmentFailedMinutesAgo(WINDOW + 1),
      NOW,
      WINDOW,
    );
    expect(view).toBeNull();
  });

  it("treats a mid-recovery ('recovering') offer like card_failure for display", () => {
    // The recovery claim is a seconds-long state; the banner staying up is
    // honest (seat held, payment unsettled) and a duplicate submit is
    // rejected atomically by the recovery claim itself.
    const view = presentCardFailureRecovery(
      makeOffer({ status: "recovering" }),
      assignmentFailedMinutesAgo(60),
      NOW,
      WINDOW,
    );
    expect(view).not.toBeNull();
    expect(view?.minutesLeft).toBe(180);
  });

  it("returns null when the offer isn't in card_failure", () => {
    expect(
      presentCardFailureRecovery(
        makeOffer({ status: "charged" }),
        assignmentFailedMinutesAgo(10),
        NOW,
        WINDOW,
      ),
    ).toBeNull();
  });

  it("returns null when there's no failure stamp or no assignment", () => {
    expect(
      presentCardFailureRecovery(makeOffer(), assignmentFailedMinutesAgo(null), NOW, WINDOW),
    ).toBeNull();
    expect(
      presentCardFailureRecovery(makeOffer(), null, NOW, WINDOW),
    ).toBeNull();
  });

  it("returns null for a missing offer", () => {
    expect(
      presentCardFailureRecovery(null, assignmentFailedMinutesAgo(10), NOW, WINDOW),
    ).toBeNull();
  });
});
