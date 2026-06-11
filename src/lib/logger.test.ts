import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { REDACT_PATHS } from "./logger";

/**
 * The singleton logger writes to stdout, so we can't assert against it
 * directly. Instead, build a pino instance with the SAME redact config the
 * singleton uses (REDACT_PATHS + remove:true) pointed at an in-memory sink,
 * and check that secrets never reach the serialized output.
 *
 * The case that motivated this test: drizzle rows are camelCased, so the
 * generic "secret"/"token" paths don't match `totpSecret` on a tickets row.
 * Logging a ticket row would have written the TOTP seed — enough to mint
 * valid rotating-QR codes — straight into the log stream.
 */

function captureLogger(): { logger: pino.Logger; lines: () => string[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = pino(
    { redact: { paths: REDACT_PATHS, remove: true } },
    sink,
  );
  return { logger, lines: () => chunks };
}

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

describe("logger redaction", () => {
  it("removes totpSecret from a logged ticket-shaped object", () => {
    const { logger, lines } = captureLogger();

    // Shape of a drizzle `tickets` row (drizzle/schema.ts) as it would be
    // logged: nested under a key, the common structured-logging pattern.
    logger.info(
      {
        ticket: {
          id: "11111111-1111-1111-1111-111111111111",
          seatAssignmentId: "22222222-2222-2222-2222-222222222222",
          totpSecret: TOTP_SECRET,
          status: "active",
        },
      },
      "ticket issued",
    );

    const [line] = lines();
    expect(line).toBeDefined();
    expect(line).not.toContain(TOTP_SECRET);
    expect(line).not.toContain("totpSecret");

    // remove:true drops the field entirely; the rest of the row survives.
    const parsed = JSON.parse(line ?? "") as {
      ticket: Record<string, unknown>;
    };
    expect(parsed.ticket).not.toHaveProperty("totpSecret");
    expect(parsed.ticket.status).toBe("active");
  });

  it("removes a top-level totpSecret too", () => {
    const { logger, lines } = captureLogger();

    logger.info({ totpSecret: TOTP_SECRET, ticketId: "abc" }, "scan check");

    const [line] = lines();
    expect(line).not.toContain(TOTP_SECRET);
    expect(JSON.parse(line ?? "")).not.toHaveProperty("totpSecret");
  });

  it("still redacts the generic secret-ish names one level deep", () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        config: {
          apiKey: "re_secret_key",
          token: "tok_123",
          password: "hunter2",
        },
      },
      "config loaded",
    );

    const [line] = lines();
    expect(line).not.toContain("re_secret_key");
    expect(line).not.toContain("tok_123");
    expect(line).not.toContain("hunter2");
  });
});
