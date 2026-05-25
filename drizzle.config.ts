import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  // drizzle-kit reads DATABASE_URL at the shell, not via src/lib/env.ts,
  // because this config runs in a plain Node context (not Next.js).
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
