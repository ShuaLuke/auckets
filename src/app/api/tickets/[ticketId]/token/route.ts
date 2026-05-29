// GET /api/tickets/[ticketId]/token — mints the fan's current rotating-QR
// token (ADR-0015).
//
// Flow: auth → validate ticketId → fetch the ticket's server-only secret →
// enforce ownership → sign + return the token. The secret never leaves the
// server: getTicketSecretForRotatingQr is the only read that touches it, and
// it's used solely to compute the HMAC in generateTicketToken — the response
// carries the signed token, never the secret.
//
// The browser polls this each ~60s window (the TicketViewer refetches when
// the window rolls over). Responses are no-store so a token can't be cached
// past its window.

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getTicketSecretForRotatingQr } from "@/lib/db/repositories";
import { generateTicketToken } from "@/lib/tickets/token";
import { uuidParam } from "@/lib/validators/uuid";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({ ticketId: uuidParam });

type TokenResponse = {
  token: string;
  expiresInSeconds: number;
  ticketId: string;
};

type ErrorBody = { error: string };

export async function GET(
  _request: Request,
  { params }: { params: { ticketId: string } },
): Promise<NextResponse<TokenResponse | ErrorBody>> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = ParamsSchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid ticketId" }, { status: 400 });
  }

  const ticket = await getTicketSecretForRotatingQr(db, parsed.data.ticketId);
  // 404 (not 403) when the ticket is missing OR not the caller's — never
  // reveal a ticket's existence to a non-owner.
  if (!ticket || ticket.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { token, expiresInSeconds } = generateTicketToken(
    ticket.id,
    ticket.totpSecret,
  );

  return NextResponse.json(
    { token, expiresInSeconds, ticketId: ticket.id },
    { headers: { "Cache-Control": "no-store" } },
  );
}
