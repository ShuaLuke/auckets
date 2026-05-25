import { serve } from "inngest/next";

import { inngest } from "@/lib/jobs/client";
import { hello } from "@/lib/jobs/functions/hello";

// Inngest's dev server discovers functions by polling this endpoint.
// Each new function in src/lib/jobs/functions/ gets registered here.
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [hello],
});
