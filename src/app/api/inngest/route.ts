import { serve } from "inngest/next";

import { inngest } from "@/lib/jobs/client";
import { allocationImminent } from "@/lib/jobs/functions/allocation-imminent";
import { cardFailureExpiry } from "@/lib/jobs/functions/card-failure-expiry";
import { hello } from "@/lib/jobs/functions/hello";
import { scheduledBinding } from "@/lib/jobs/functions/scheduled-binding";
import { ticketIssuance } from "@/lib/jobs/functions/ticket-issuance";

// Every Inngest step executes as its own HTTP invocation of this route, so
// maxDuration bounds ONE step, not a whole function run. The scheduled-
// binding sweep keeps steps small (capture batches of 10 ≈ tens of seconds
// of Stripe I/O), but a step killed at the deadline is retried by Inngest
// against idempotent operations — 300s (the Vercel Pro ceiling without
// Fluid Compute) is generous headroom so the retry path stays the
// exception, not the norm. Without this export the route ran under
// Vercel's default (~15s), which a slow Stripe stretch could blow.
export const maxDuration = 300;

// Inngest's dev server discovers functions by polling this endpoint.
// Each new function in src/lib/jobs/functions/ gets registered here.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    hello,
    scheduledBinding,
    cardFailureExpiry,
    ticketIssuance,
    allocationImminent,
  ],
});
