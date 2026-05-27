// Barrel — import presenters from "@/lib/presenters".
//
// Presenters are pure functions: (rawShape, now: Date, tz?: string) → ViewShape.
// They take repository raw shapes and produce JSON-serializable view shapes
// that match the prototype JSX in design/ui_kits/auckets/screens/*.jsx
// field-for-field (minus deferred-needs-join fields).

export {
  DEFAULT_TZ,
  formatBindingCountdown,
  formatCountdown,
  formatDateLong,
  formatDateShort,
} from "./format";

export {
  presentShowDetail,
  presentShowSummary,
  type ShowDetailView,
  type ShowStatus,
  type ShowSummaryView,
} from "./shows";

export {
  formatSeatAssignmentPreview,
  presentOffer,
  type OfferStatus,
  type OfferView,
} from "./offers";

export {
  computeShowCapacity,
  presentArtistShowSummary,
  presentArtistSnapshotStats,
  presentTierBreakdown,
  type ArtistShowSummaryView,
  type ArtistSnapshotStatsView,
  type TierBreakdownView,
  type TierBucketView,
} from "./artist-shows";

export { presentBidView, type BidView } from "./bids";

export {
  formatTimeAgo,
  presentRecentActivity,
  type ActivityEvent,
} from "./activity";
