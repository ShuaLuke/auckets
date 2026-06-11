// Pure math for the price dial's tier-floor tick marks (UI-4). Given the
// show's tier floors and the dial's dollar bounds, returns where along the
// track (as a 0..1 fraction) each tier's floor sits. The composer turns the
// fraction into a CSS position; keeping the math here keeps it testable.

export type DialTick = {
  tier: string;
  floorCents: number;
  /** 0..1 position along the dial's travel. */
  fraction: number;
};

export function dialTickFractions(
  tierFloorsCents: Record<string, number>,
  minDollars: number,
  maxDollars: number,
): DialTick[] {
  const span = maxDollars - minDollars;
  if (span <= 0) return [];
  return Object.entries(tierFloorsCents)
    .map(([tier, floorCents]) => ({
      tier,
      floorCents,
      fraction: (floorCents / 100 - minDollars) / span,
    }))
    .filter((t) => t.fraction >= 0 && t.fraction <= 1)
    .sort((a, b) => a.fraction - b.fraction);
}
