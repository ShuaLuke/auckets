// Barrel — import repository functions from "@/lib/db/repositories".
//
// Repositories return raw DB shapes only (timestamps as Date, money as
// integer cents, statuses as raw enum strings, camelCase fields, JSONB
// columns untouched). Display formatting lives in src/lib/presenters/.

export {
  getArtistById,
  getArtistBySlug,
  listArtistsManageableByUser,
  userCanManageArtist,
  type ManageableArtist,
} from "./artists";

export {
  ARTIST_REQUEST_KINDS,
  ARTIST_REQUEST_STATUSES,
  createArtistRequest,
  denyArtistRequest,
  executeArtistRequest,
  isArtistRequestFiledBy,
  listArtistRequestsForAdminInbox,
  listArtistRequestsForShow,
  listOpenArtistRequests,
  type ArtistRequest,
  type ArtistRequestInboxRow,
  type ArtistRequestKind,
  type ArtistRequestStatus,
} from "./artist-requests";

export {
  listRecentAllocationLogsForShow,
  type AllocationLog,
} from "./allocation-logs";

export {
  acknowledgeDisplacementEvent,
  getLatestRaiseTargetsByOfferForShow,
  listUnacknowledgedDisplacementEventsForUser,
  type DisplacementEvent,
} from "./displacement-events";

export {
  WEBHOOK_TERMINAL_STATUSES,
  getWebhookEvent,
  markWebhookEvent,
  recordWebhookReceived,
  type StripeWebhookEvent,
} from "./stripe-webhook-events";

export {
  HOLD_KINDS,
  createHold,
  deleteHoldById,
  getHoldById,
  listHoldsForShow,
  type Hold,
  type HoldKind,
} from "./holds";

export {
  getOfferByPaymentIntentId,
  getOfferByShowAndUser,
  getOfferStatsByShowIds,
  getOfferStatsByTierForShow,
  getOfferStatsForArtist,
  getOfferStatsForShow,
  getPriceDistributionForShow,
  getUserRankInShowPool,
  listBidsForUser,
  listOfferRevisionsByOfferIds,
  listOfferRevisionsForOffer,
  listOffersForUser,
  listPoolOffersForShow,
  listRecentOffersForShow,
  upsertOfferForUser,
  type Offer,
  type OfferRevision,
  type OfferStats,
  type OfferTierBucket,
  type PriceDistributionBucket,
  type UserBidRow,
} from "./offers";

export {
  ensureUserMirror,
  getEmailsByUserIds,
  setStripeCustomerId,
  userIsAdmin,
} from "./users";

export {
  getShowById,
  listAllShows,
  listOpenShows,
  listShowsForArtist,
  type ShowSummary,
  type ShowWithRelations,
  type VenueArchitecture as ShowVenueArchitecture,
} from "./shows";

export {
  getVenueArchitectureById,
  getVenueArchitecturesByIds,
  getVenueById,
  type VenueArchitecture,
} from "./venues";

export {
  getProvisionalFilledByShow,
  getProvisionalFilledByShowIds,
  getSeatAssignmentByOfferId,
  listSeatAssignmentsByOfferIds,
  listSeatAssignmentsForShow,
  type SeatAssignment,
} from "./seat-assignments";

export {
  getTicketByAssignmentId,
  getTicketSecretForRotatingQr,
  listTicketsByAssignmentIds,
  type TicketSecret,
  type TicketStatus,
  type TicketSummary,
} from "./tickets";
