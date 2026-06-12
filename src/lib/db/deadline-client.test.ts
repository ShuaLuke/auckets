// @vitest-environment node

import { createServer, type Server, type Socket } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createDeadlineClient, DbDeadlineError } from "./deadline-client";

/**
 * A fake Postgres server that completes the startup handshake and then goes
 * silent forever — the same shape as the prod wedge (backend `active` +
 * `wait_event ClientRead`, no response ever coming). Without the deadline
 * wrapper, a query against this server hangs the caller indefinitely.
 */

// AuthenticationOk: 'R' + len 8 + code 0
const AUTH_OK = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
// ReadyForQuery: 'Z' + len 5 + 'I' (idle)
const READY_FOR_QUERY = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
// CommandComplete: 'C' + len 13 + "SELECT 1\0" — enough to resolve a simple
// ('Q') protocol query, which is what postgres.js sends for an unsafe()
// call with no params and prepare:false.
const COMMAND_COMPLETE = Buffer.concat([
  Buffer.from([0x43, 0, 0, 0, 13]),
  Buffer.from("SELECT 1\0", "latin1"),
]);

describe("createDeadlineClient against a wedged socket", () => {
  let server: Server;
  let port: number;
  const sockets = new Set<Socket>();
  // Everything clients write after connecting, decoded loosely — query text
  // appears verbatim inside simple-protocol messages, so tests can assert
  // what reached the wire (and, for the no-pipelining test, what didn't).
  let wireLog = "";
  // The NEXT connection answers this many queries successfully before going
  // silent — so a test can get a warm, established connection (the prod
  // shape: warm lambda) or a successfully-opened transaction, then wedge it.
  // Latched per-socket at startup: leftover sockets from earlier tests (a
  // client teardown flushes a Terminate byte at an arbitrary later moment)
  // can't consume another test's budget.
  let answerNextQueries = 0;

  beforeAll(async () => {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      let budget: number | null = null;
      socket.on("data", (chunk) => {
        wireLog += chunk.toString("latin1");
        if (budget === null) {
          budget = answerNextQueries;
          answerNextQueries = 0;
          socket.write(Buffer.concat([AUTH_OK, READY_FOR_QUERY]));
        } else if (chunk[0] !== 0x58 /* Terminate */ && budget > 0) {
          budget--;
          socket.write(Buffer.concat([COMMAND_COMPLETE, READY_FOR_QUERY]));
        }
        // else: the wedge — never send another byte no matter what arrives.
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("expected a TCP address");
    port = address.port;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  function makeClient(options: Parameters<typeof createDeadlineClient>[2]) {
    return createDeadlineClient(
      `postgres://test:test@127.0.0.1:${port}/test`,
      // fetch_types:false — the type-OID bootstrap query would itself wedge
      // against this server before any test query runs.
      { max: 1, prepare: false, fetch_types: false, connect_timeout: 5 },
      options,
    );
  }

  it("rejects a query within the deadline instead of hanging", async () => {
    const onDeadline = vi.fn();
    const { client, raw } = makeClient({ queryDeadlineMs: 250, onDeadline });
    const started = Date.now();

    await expect(client.unsafe("select 1")).rejects.toBeInstanceOf(
      DbDeadlineError,
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(onDeadline).toHaveBeenCalledTimes(1);
    expect(onDeadline).toHaveBeenCalledWith({ scope: "query", ms: 250 });
    await raw.end({ timeout: 0 });
  });

  it("rejects through the .values() chain Drizzle uses", async () => {
    const onDeadline = vi.fn();
    const { client, raw } = makeClient({ queryDeadlineMs: 250, onDeadline });

    await expect(client.unsafe("select 1").values()).rejects.toBeInstanceOf(
      DbDeadlineError,
    );

    expect(onDeadline).toHaveBeenCalledWith({ scope: "query", ms: 250 });
    await raw.end({ timeout: 0 });
  });

  it("rejects a transaction wedged at BEGIN within the transaction deadline", async () => {
    const onDeadline = vi.fn();
    const { client, raw } = makeClient({
      queryDeadlineMs: 250,
      transactionDeadlineMs: 500,
      onDeadline,
    });
    const started = Date.now();

    await expect(
      client.begin(async (tx) => {
        // Never reached: BEGIN itself gets no reply, so only the
        // whole-transaction deadline can fire.
        await tx.unsafe("select 1");
      }),
    ).rejects.toBeInstanceOf(DbDeadlineError);

    expect(Date.now() - started).toBeLessThan(3_000);
    expect(onDeadline).toHaveBeenCalledWith({ scope: "transaction", ms: 500 });
    await raw.end({ timeout: 0 });
  });

  it("issues one statement at a time — never pipelines onto the wire", async () => {
    wireLog = "";
    answerNextQueries = 1;
    try {
      const onDeadline = vi.fn();
      const { client, raw } = makeClient({ queryDeadlineMs: 5_000, onDeadline });

      // Establish the connection with a query the server answers — the warm
      // lambda state. postgres.js only pipelines onto a connection that is
      // already established and busy (cold dispatch just queues client-side),
      // so the warm-up is what makes this test able to catch regressions.
      await client.unsafe("select 0");

      // Now the server is silent. Issue two queries concurrently, the way a
      // page's Promise.all does. Without serialization postgres.js writes the
      // second onto the socket while the first is still unanswered — the
      // pipelining that desyncs a transaction-mode pooler and wedges the
      // backend.
      const q1 = Promise.resolve(client.unsafe("select 111")).catch(() => {});
      const q2 = Promise.resolve(client.unsafe("select 222")).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(wireLog).toContain("select 111");
      expect(wireLog).not.toContain("select 222");

      await raw.end({ timeout: 0 });
      await Promise.all([q1, q2]);
    } finally {
      answerNextQueries = 0;
    }
  });

  it("a transaction's inner queries don't deadlock against the wire mutex", async () => {
    answerNextQueries = 1; // BEGIN succeeds; the inner query wedges
    try {
      const onDeadline = vi.fn();
      const { client, raw } = makeClient({
        queryDeadlineMs: 250,
        transactionDeadlineMs: 1_000,
        onDeadline,
      });

      await expect(
        client.begin(async (tx) => {
          await tx.unsafe("select 1");
        }),
      ).rejects.toBeInstanceOf(DbDeadlineError);

      // The INNER query's own deadline must be what fires. If tx-scoped
      // queries acquired the mutex (held by the enclosing transaction),
      // they'd deadlock and only the transaction deadline could fire.
      expect(onDeadline).toHaveBeenCalledWith({ scope: "query", ms: 250 });
      await raw.end({ timeout: 0 });
    } finally {
      answerNextQueries = 0;
    }
  });

  it("does not start the deadline clock until the query is awaited", async () => {
    const onDeadline = vi.fn();
    const { client, raw } = makeClient({ queryDeadlineMs: 250, onDeadline });

    // Build but don't await — lazy queries haven't executed yet, so no
    // deadline should be running.
    client.unsafe("select 1");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(onDeadline).not.toHaveBeenCalled();
    await raw.end({ timeout: 0 });
  });
});
