// Public surface of the simulator core. Pure — see docs/GAE_SIMULATOR.md.
export { runScenario, percentiles, stableStringify, sha256, POLICIES } from "./run";
export { generatePool, parseGroupMixArg, resolveGroupMix, GROUP_MIX_PRESETS, DEFAULT_PREFERENCE_MIX } from "./demand";
export { offersFromCsv, loadPoolCsv, offersFromSheet, poolToCsv, offerParitySummary, parseCsv, parseTierPref, formatTierPref, toCents } from "./pool";
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
export { renderFillReport, renderConsoleSummary, renderOffersCsv, renderSeatMap } from "./report";
export { usd, pct } from "./format";
export { parsePolicy, singleSeatRowCount, POLICY_HELP } from "./policy";
export { resolveAutoBids, incrementFor, DEFAULT_RAISE_RULE } from "./autobid";
export { ScenarioSchema, VenueFileSchema, TierSpecFileSchema, formatIssues } from "./schema";
export { createRng } from "./rng";
export type * from "./types";
export { parseVaryArg, applyVary, normalizePath, labelFor, slimOutput, assembleSweep, renderSweep, renderSweepCsv, renderSweepConsole } from "./sweep";
export { simulateWindow, finishTimeline, drawArrival } from "./temporal";
