import { inngest } from "@/lib/jobs/client";
import { logger } from "@/lib/logger";

/**
 * No-op handler to confirm Inngest wiring (Week 1 roadmap item).
 *
 * Fire from anywhere via:
 *   await inngest.send({ name: "test/hello.world", data: { from: "..." } });
 *
 * Delete once we have real jobs (allocation, payment capture, etc).
 */
export const hello = inngest.createFunction(
  {
    id: "hello-world",
    triggers: [{ event: "test/hello.world" }],
  },
  async ({ event }) => {
    logger.info({ event }, "inngest hello-world received");
    return { received: true };
  },
);
