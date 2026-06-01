// URL-safe slug derivation for artist (and future entity) slugs.
//
// Pure + dependency-free so it's safe to import on the client (the artist
// create form prefills the slug field live as the operator types the name)
// and on the server (the admin route derives a slug when one isn't given).
//
// The output matches the route's validation regex /^[a-z0-9-]+$/. The DB's
// UNIQUE constraint on artists.slug is the real collision guard — this only
// shapes a candidate; createArtist returns a typed `slug_taken` on conflict.

const NON_ALNUM = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(NON_ALNUM, "-") // runs of non-alphanumerics (incl. spaces) → one hyphen
    .replace(EDGE_HYPHENS, ""); // no leading/trailing hyphens
}
