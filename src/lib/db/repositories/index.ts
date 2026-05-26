// Barrel — import repository functions from "@/lib/db/repositories".
//
// Repositories return raw DB shapes only (timestamps as Date, money as
// integer cents, statuses as raw enum strings, camelCase fields, JSONB
// columns untouched). Display formatting lives in src/lib/presenters/.

export {
  getArtistById,
  getArtistBySlug,
} from "./artists";

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
  getVenueById,
  type VenueArchitecture,
} from "./venues";
