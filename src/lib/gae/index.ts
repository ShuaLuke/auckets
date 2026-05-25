// Public entry point for the Greenwood Allocation Engine.
// See docs/GAE_SPEC.md for the spec and ./types.ts for the contract.
//
// The `allocate(venue, offers, config)` function lands in a later slice
// once rankkey/launchpad/fitresolver/placement/waterfall exist. This file
// currently re-exports the public type surface so call sites can import
// from "@/lib/gae" today and keep working as the engine fills in.

export type {
  VenueArchitecture,
  VenueRow,
  RankedOffer,
  TierPreference,
  AllocationConfig,
  AllocationResult,
  SeatAssignment,
  AllocationDecision,
} from "./types";
