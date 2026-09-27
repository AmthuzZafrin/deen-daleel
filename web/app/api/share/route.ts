/**
 * Public links to a conversation.
 *
 * POST is the owner making a link: scoped by session like every other
 * conversation route, it mints `share_token` once and returns it thereafter, so
 * sharing the same chat twice yields the same link. GET is anyone holding that
 * link, and is the one conversation read that does *not* check the session --
 * the token is the permission. The conversation id never leaves in a share
 * response, since it is what the owner's own session uses to reach the chat.
 */

import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { query } from "@/lib/db";
import { readSessionId } from "@/lib/session";
import { loadThread } from "@/lib/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const sessionId = await readSessionId();
  let body: { id?: unknown };
  try {
    body = (await req.json()) as { id?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!sessionId || !UUID.test(id)) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const rows = await query<{ share_token: string }>(
    `update conversations
        set share_token = coalesce(share_token, $3::uuid)
      where id = $1 and user_id = $2
      returning share_token`,
    [id, sessionId, randomUUID()],
  );
  if (rows.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ token: rows[0].share_token });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!UUID.test(token)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const rows = await query<{ id: string; title: string }>(
    `select id, title from conversations where share_token = $1`,
    [token],
  );
  if (rows.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json(
    { title: rows[0].title, messages: await loadThread(rows[0].id) },
    { headers: { "cache-control": "no-store" } },
  );
}
