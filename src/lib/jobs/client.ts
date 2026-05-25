import { Inngest } from "inngest";

/**
 * Inngest singleton client.
 *
 * Per ADR-0005 / docs/ARCHITECTURE.md: anything that takes more than ~3
 * seconds, must retry, runs on a schedule, or fans out goes through Inngest.
 * Most concretely: the allocation runs (preview + binding), payment
 * captures, email batches, and bond recomputes.
 *
 * Events are typed via the function signatures in src/lib/jobs/functions/.
 * In production we set INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY in the
 * environment; locally `npx inngest-cli dev` runs unauthenticated.
 */
export const inngest = new Inngest({
  id: "auckets",
});
