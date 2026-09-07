// Zod schemas for everything the sim reads from disk: venue files, scenario
// files, and the tier-spec upload shape. Validation errors are rewritten to
// read like a colleague pointing at the problem ("rows[37].capacity ...").

import { z } from "zod";

const RowSchema = z.strictObject({
  id: z.string().min(1),
  area: z.string().min(1),
  section: z.string(),
  rowName: z.string(),
  rowRank: z.number().int().positive(),
  capacity: z.number().int().nonnegative(),
  parity: z.enum(["ODD", "EVEN"]),
  lean: z.enum(["CENTER", "LEFT", "RIGHT", "DUAL_AISLE"]),
  seatNumbers: z.array(z.string().min(1)),
  holds: z.array(z.string()),
  tier: z.string().min(1).optional(),
  isGa: z.boolean().optional(),
});

export const VenueFileSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case, e.g. lincoln-v4"),
  displayName: z.string().min(1),
  venueId: z.string().min(1),
  rows: z.array(RowSchema).min(1),
  activeRowIds: z.array(z.string()).optional(),
  tierFloorsCents: z.record(z.string(), z.number().int().positive()).optional(),
  relief: z
    .record(
      z.string(),
      z.strictObject({ single: z.boolean().optional(), gapRelief: z.boolean().optional() }),
    )
    .optional(),
  notes: z.string().optional(),
  source: z
    .strictObject({
      kind: z.string(),
      file: z.string().optional(),
      importedAt: z.string().optional(),
    })
    .optional(),
});

export const TierSpecFileSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1),
  tiers: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        rowCount: z.number().int().positive(),
        seatsPerRow: z.number().int().positive(),
        isGa: z.boolean().optional(),
        unitType: z.enum(["rows", "tables", "boxes", "ga", "custom"]).optional(),
        customLabel: z.string().optional(),
        floorCents: z.number().int().positive().optional(),
      }),
    )
    .min(1),
  notes: z.string().optional(),
});

const HoldSpecSchema = z
  .strictObject({
    source: z.enum(["venue", "artist", "comp", "production"]),
    seatIds: z.array(z.string().regex(/^.+:.+$/, '"<rowId>:<seatNumber>"')).optional(),
    tier: z.string().optional(),
    seats: z.number().int().positive().optional(),
  })
  .refine(
    (h) => (h.seatIds !== undefined) !== (h.tier !== undefined && h.seats !== undefined),
    { message: "a hold needs either seatIds, or tier + seats (not both)" },
  );

export const ShowOverlaySchema = z.strictObject({
  activeSections: z.array(z.string().min(1)).optional(),
  activeRowIds: z.array(z.string().min(1)).optional(),
  holds: z.array(HoldSpecSchema).optional(),
  floorsCents: z.record(z.string(), z.number().int().positive()).optional(),
  maxGroupSize: z.number().int().min(1).max(50).optional(),
});

const GroupMixPresetSchema = z.enum([
  "even-heavy",
  "odd-heavy",
  "singles-rich",
  "couples",
  "big-groups",
  "lincoln-v4",
]);

// { "1": 10, "2": 45, ... } — percent of OFFERS per group size, sums to 100.
export const GroupSizeMixSchema = z
  .record(z.string().regex(/^[1-9][0-9]?$/, "group size 1–99"), z.number().nonnegative())
  .refine((m) => Math.abs(Object.values(m).reduce((s, v) => s + v, 0) - 100) < 0.01, {
    message: "group-size percentages must sum to 100",
  })
  .refine((m) => Object.values(m).some((v) => v > 0), { message: "at least one size > 0%" });

const PriceModelSchema = z.union([
  z.strictObject({
    kind: z.literal("ladder"),
    ladderCents: z.number().int().positive().optional(),
    meanStepsAboveFloor: z.number().nonnegative().optional(),
    maxStepsAboveFloor: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    kind: z.literal("lognormal"),
    ladderCents: z.number().int().positive().optional(),
    medianMultiple: z.number().min(1).optional(),
    sigma: z.number().nonnegative().optional(),
  }),
]);

const RaiseRuleSchema = z.union([
  z.strictObject({ kind: z.literal("fixed"), cents: z.number().int().positive() }),
  z.strictObject({ kind: z.literal("percent"), pct: z.number().positive().max(100) }),
]);

export const POLICY_PATTERN = /^(greedy|clean-fit|parity-tiebreak|singles-reserve(:\d+)?)(\+(clean-fit|parity-tiebreak|singles-reserve(:\d+)?))*$/;

export const DemandModelSchema = z.strictObject({
  seed: z.number().int().nonnegative(),
  oversubscription: z.number().positive().max(20),
  groupSizeMix: z.union([GroupMixPresetSchema, GroupSizeMixSchema]),
  priceModel: PriceModelSchema,
  tierPreferenceMix: z
    .strictObject({
      specific: z.number().nonnegative(),
      this_or_worse: z.number().nonnegative(),
      this_or_better: z.number().nonnegative(),
      any: z.number().nonnegative(),
    })
    .optional(),
  tierChoice: z.enum(["premium-biased", "uniform"]).optional(),
  autoBid: z
    .strictObject({
      sharePct: z.number().min(0).max(100),
      capMultiplier: z.tuple([z.number().min(1), z.number().min(1)]).refine(([lo, hi]) => hi >= lo, { message: "capMultiplier must be [lo, hi] with hi ≥ lo" }),
    })
    .optional(),
});

export const ScenarioSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "kebab-case"),
  venue: z.union([z.string().min(1), z.strictObject({ file: z.string().min(1) })]),
  show: ShowOverlaySchema.optional(),
  pool: z.union([
    z.strictObject({ file: z.string().min(1) }),
    z.strictObject({ generate: DemandModelSchema }),
  ]),
  policies: z.array(z.string().regex(POLICY_PATTERN, 'a policy is "greedy", "clean-fit", "parity-tiebreak", "singles-reserve[:k]", or a "+"-joined combination')).min(1).optional(),
  seeds: z.number().int().min(1).max(1000).optional(),
  autoBidRaiseRule: RaiseRuleSchema.optional(),
});

// Turn a Zod failure into one readable line per issue.
export function formatIssues(prefix: string, error: z.ZodError): string {
  return error.issues
    .map((i) => `${prefix}${i.path.length > 0 ? " at " + i.path.map(String).join(".") : ""}: ${i.message}`)
    .join("\n");
}
