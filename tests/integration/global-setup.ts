import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Vitest globalSetup — runs ONCE before any test file, in a separate Node
// process from the workers. Applies the drizzle migrations into the test
// database so each test file starts against a known schema.
//
// We deliberately do NOT import @/lib/db here: that module reads env vars at
// import time, and globalSetup runs before vitest.config.ts's `test.env`
// reaches the worker pool. Instead we read TEST_DATABASE_URL (or fall back
// to the same Docker default the config uses) and stand up our own client
// for the migration run, then dispose of it.
//
// Defense-in-depth: refuse to run unless the database host is clearly local.
// The vitest config already injects a local default into worker env, but a
// developer could override DATABASE_URL on the CLI and we'd rather fail
// loudly than TRUNCATE the wrong project's data.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres", "::1"]);

function assertLocalDatabase(url: string): void {
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Integration tests refuse to run against host "${parsed.hostname}". ` +
        `Only localhost / 127.0.0.1 / the CI "postgres" service container are allowed. ` +
        `Set TEST_DATABASE_URL to a local-only URL.`,
    );
  }
}

export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5433/auckets_test";

  assertLocalDatabase(url);

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: "./drizzle/migrations" });
  } finally {
    await client.end();
  }
}
