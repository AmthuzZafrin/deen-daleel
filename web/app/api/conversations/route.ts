/**
 * Conversation list and history.
 *
 * Every query is scoped by the caller's session id, so a guessed conversation
 * id returns nothing rather than someone else's chat.
 */

import type { NextRequest } from "next/server";

import { query } from "@/lib/db";
import { readSessionId } from "@/lib/session";
import { loadThread } from "@/lib/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = await readSessionId();
  if (!sessionId) return Response.json({ conversations: [] });

  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    // Pinned chats are fetched regardless of age, so a pin never falls off
    // the end of the recent-100 window it was meant to rise above.
    const rows = await query<{
      id: string;
      title: string;
      updated_at: Date;
      pinned_at: Date | null;
    }>(
      `(select id, title, updated_at, pinned_at
          from conversations
         where user_id = $1 and pinned_at is not null)
       union all
       (select id, title, updated_at, pinned_at
          from conversations
         where user_id = $1 and pinned_at is null
         order by updated_at desc
         limit 100)`,
      [sessionId],
    );
    return Response.json({
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updated_at.toISOString(),
        pinnedAt: r.pinned_at?.toISOString() ?? null,
      })),
    });
  }

  const owned = await query<{ id: string }>(
    `select id from conversations where id = $1 and user_id = $2`,
    [id, sessionId],
  );
  if (owned.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  return Response.json({
    conversationId: id,
    messages: await loadThread(id),
  });
}

/** Pin or unpin. The only field a reader can change on a conversation. */
export async function PATCH(req: NextRequest) {
  const sessionId = await readSessionId();
  const id = req.nextUrl.searchParams.get("id");
  if (!sessionId || !id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  let body: { pinned?: unknown };
  try {
    body = (await req.json()) as { pinned?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.pinned !== "boolean") {
    return Response.json({ error: "pinned must be a boolean" }, { status: 400 });
  }

  const rows = await query<{ id: string }>(
    `update conversations
        set pinned_at = case when $3 then now() else null end
      where id = $1 and user_id = $2
      returning id`,
    [id, sessionId, body.pinned],
  );
  if (rows.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sessionId = await readSessionId();
  const id = req.nextUrl.searchParams.get("id");
  if (!sessionId || !id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  await query(`delete from conversations where id = $1 and user_id = $2`, [
    id,
    sessionId,
  ]);
  return Response.json({ ok: true });
}
