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

describe("createDeadlineClient against a wedged socket", () => {
  let server: Server;
  let port: number;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    server = createServer((socket) => {
      sockets.add(socket);
      socket.on("error", () => {});
      // Answer the StartupMessage so the client believes it's connected,
      // then never send another byte no matter what arrives.
      socket.once("data", () => {
        socket.write(Buffer.concat([AUTH_OK, READY_FOR_QUERY]));
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
