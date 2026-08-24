/**
 * Conversation list and history.
 *
 * Every query is scoped by the caller's session id, so a guessed conversation
 * id returns nothing rather than someone else's chat.
 */

import type { NextRequest } from "next/server";

import { query } from "@/lib/db";
import { REF_COLUMNS } from "@/lib/rag/refs";
import { readSessionId } from "@/lib/session";
import type { Citation, Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sessionId = await readSessionId();
  if (!sessionId) return Response.json({ conversations: [] });

  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    const rows = await query<{ id: string; title: string; updated_at: Date }>(
      `select id, title, updated_at
         from conversations
        where user_id = $1
        order by updated_at desc
        limit 100`,
      [sessionId],
    );
    return Response.json({
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        updatedAt: r.updated_at.toISOString(),
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

  const messages = await query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    metadata: { retrievedChunkIds?: number[] } | null;
  }>(
    `select id, role, content, metadata
       from messages
      where conversation_id = $1
      order by created_at`,
    [id],
  );

  // Rehydrate citations from message_citations, joined back to the chunk they
  // point at. This is what keeps an old answer's daleel clickable — without it
  // reopening a chat would show prose with dead references.
  const citationRows = await query<{
    message_id: string;
    ordinal: number;
    cited_text: string;
    chunk_id: string;
    canonical_ref: string;
    kind: Source["kind"];
    source_title: string;
    permalink: string | null;
    arabic_text: string | null;
    english_text: string | null;
    attribution: string | null;
    chapter_level: boolean;
  }>(
    `select mc.message_id, mc.ordinal, mc.cited_text,
            c.id as chunk_id, c.kind,
            ${REF_COLUMNS},
            d.permalink, d.arabic_text, d.english_text,
            s.title as source_title, s.attribution
       from message_citations mc
       join messages  m on m.id = mc.message_id
       join chunks    c on c.id = mc.chunk_id
       join documents d on d.id = c.document_id
       join sources   s on s.id = c.source_id
      where m.conversation_id = $1
      order by mc.message_id, mc.ordinal`,
    [id],
  );

  const citationsByMessage = new Map<string, Citation[]>();
  const sourcesByMessage = new Map<string, Source[]>();

  for (const row of citationRows) {
    const chunkId = Number(row.chunk_id);

    const citations = citationsByMessage.get(row.message_id) ?? [];
    citations.push({
      ordinal: row.ordinal,
      chunkId,
      canonicalRef: row.canonical_ref,
      citedText: row.cited_text,
    });
    citationsByMessage.set(row.message_id, citations);

    const sources = sourcesByMessage.get(row.message_id) ?? [];
    if (!sources.some((s) => s.chunkId === chunkId)) {
      sources.push({
        chunkId,
        canonicalRef: row.canonical_ref,
        kind: row.kind,
        sourceTitle: row.source_title,
        permalink: row.permalink,
        arabicText: row.arabic_text,
        englishText: row.english_text,
        attribution: row.attribution,
        chapterLevel: row.chapter_level,
      });
    }
    sourcesByMessage.set(row.message_id, sources);
  }

  return Response.json({
    conversationId: id,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      citations: citationsByMessage.get(m.id) ?? [],
      sources: sourcesByMessage.get(m.id) ?? [],
    })),
  });
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
