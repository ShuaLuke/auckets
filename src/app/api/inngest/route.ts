import { serve } from "inngest/next";

import { inngest } from "@/lib/jobs/client";
import { allocationImminent } from "@/lib/jobs/functions/allocation-imminent";
import { cardFailureExpiry } from "@/lib/jobs/functions/card-failure-expiry";
import { hello } from "@/lib/jobs/functions/hello";
import { scheduledBinding } from "@/lib/jobs/functions/scheduled-binding";
import { ticketIssuance } from "@/lib/jobs/functions/ticket-issuance";

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
