import pino, { type Logger } from "pino";

/**
 * Singleton pino logger.
 *
 * Per docs/CONVENTIONS.md: never use console.log in committed code. Import
 * `logger` from here and use structured fields, not formatted strings —
 * `logger.info({ offerId, userId }, "offer submitted")`, not
 * `` logger.info(`offer ${offerId} submitted`) ``.
 *
 * Per docs/SECURITY.md #30: known-secret field names are redacted by default
 * so we don't accidentally log API keys, session tokens, etc. Pino removes
 * the fields entirely (rather than replacing with `[REDACTED]`) so the
 * existence of a secret field doesn't leak either.
 */

const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

const isDev = process.env.NODE_ENV === "development";

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  redact: {
    paths: REDACT_PATHS,
    remove: true,
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
