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
  presentOfferHistory,
  type OfferHistoryView,
  type RevisionEntry,
} from "./revisions";

export {
  presentPriceDistribution,
  type DistributionBucketView,
  type PriceDistributionView,
} from "./distribution";

export {
  formatTimeAgo,
  presentRecentActivity,
  type ActivityEvent,
} from "./activity";

export {
  presentProvisionalPlacement,
  type PlacementRow,
  type PlacementSeat,
  type PlacementSection,
  type ProvisionalPlacementView,
  type SeatStatus,
} from "./placement";

export {
  formatSeatNumbers,
  presentHolds,
  type HoldRowView,
  type HoldsView,
} from "./holds";

export {
  presentArtistRequestInboxRow,
  type ArtistRequestInboxView,
} from "./artist-requests";

export { presentRankBoard, type RankBoardView } from "./rank-board";

export {
  presentPreviewBanner,
  type PreviewBannerView,
} from "./preview-banner";

export {
  presentFanVenuePreview,
  type FanRow,
  type FanSeat,
  type FanSeatStatus,
  type FanSection,
  type VenuePreviewView,
} from "./venue-preview";
