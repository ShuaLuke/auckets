// Barrel — import repository functions from "@/lib/db/repositories".
//
// Repositories return raw DB shapes only (timestamps as Date, money as
// integer cents, statuses as raw enum strings, camelCase fields, JSONB
// columns untouched). Display formatting lives in src/lib/presenters/.

export {
  getArtistById,
  getArtistBySlug,
  userCanManageArtist,
} from "./artists";

export {
  getOfferByShowAndUser,
  getOfferStatsByShowIds,
  getOfferStatsForArtist,
  getOfferStatsForShow,
  listOffersForUser,
  type OfferStats,
} from "./offers";

export {
  getShowById,
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
  type SeatAssignment,
} from "./seat-assignments";
