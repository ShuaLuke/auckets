import { z } from "zod";

/**
 * Lenient UUID-shape validator for route params and request bodies.
 *
 * Why not z.uuid()?
 *
 * Zod 4's `z.uuid()` enforces RFC-9562 conformance: the version nibble
 * (char 14) must be 1-8 and the variant nibble (char 19) must be 8/9/a/b.
 * Those nibbles are properties of how a UUID was *generated*, not of
 * what makes a UUID a valid string identifier. Our seed data uses
 * "00000000-...", "11111111-...", "22222222-..." style mnemonics that
 * are intentionally not RFC-compliant, and z.uuid() rejects them —
 * which silently 404s every route that hits seed data.
 *
 * Real production IDs come from Postgres `gen_random_uuid()`, which
 * IS RFC-9562 compliant, so they satisfy both regexes. The lenient
 * check only widens what we accept on seed/dev IDs.
 *
 * The format check (8-4-4-4-12 hex) still gives us:
 *   - Clear, fast failure on garbage input at the route boundary
 *   - Compatibility with Postgres uuid column input syntax
 *   - No path-traversal risk in URL params
 */
export const uuidParam = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid UUID format",
  );
