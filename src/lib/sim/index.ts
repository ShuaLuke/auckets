// Public surface of the simulator core. Pure — see docs/GAE_SIMULATOR.md.
export { runScenario, percentiles, stableStringify, sha256, POLICIES } from "./run";
export { generatePool, parseGroupMixArg, resolveGroupMix, GROUP_MIX_PRESETS, DEFAULT_PREFERENCE_MIX } from "./demand";
export { offersFromCsv, offersFromSheet, poolToCsv, offerParitySummary, parseCsv, parseTierPref, formatTierPref, toCents } from "./pool";
export { venueFromCopeRowRank, slug } from "./importers/cope-rowrank";
export { venueFromManifest, detectDelimiter } from "./importers/manifest";
export { compareRuns, renderComparison, renderComparisonConsole, poolLabel } from "./compare";
export {
  parseVenueFile,
  venueFromTierSpec,
  applyShowOverlay,
  venueParitySummary,
  tierOrder,
  activeRows,
  toArchitecture,
  maxRunLength,
  SimInputError,
} from "./venue";
export { computeMetrics } from "./metrics";
export { checkInvariants } from "./invariants";
export { renderFillReport, renderConsoleSummary, renderOffersCsv, renderSeatMap, usd, pct } from "./report";
export { ScenarioSchema, VenueFileSchema, TierSpecFileSchema, formatIssues } from "./schema";
export { createRng } from "./rng";
export type * from "./types";
