/**
 * A conversation's messages, rebuilt for display: citations rejoined to the
 * chunks they point at, translations attached, and a miss's retrieved passages
 * restored from its metadata.
 *
 * Shared by the owner's view and the public share page. It does no ownership
 * check itself -- each caller decides who may reach `id` before calling it.
 */

import { query } from "@/lib/db";
import { REF_COLUMNS } from "@/lib/rag/refs";
import { attachTranslations } from "@/lib/rag/translations";
import type { ChatMessage, Citation, Source } from "@/lib/types";

export async function loadThread(id: string): Promise<ChatMessage[]> {
  const messages = await query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    metadata: {
      matched?: boolean;
      matchScore?: number;
      topScore?: number | null;
      retrievedChunkIds?: number[];
      alternatives?: { slug: string; question: string; score: number }[];
      confident?: boolean;
    } | null;
    answer_slug: string | null;
    answer_question: string | null;
    reviewed_by: string | null;
    reviewed_at: Date | null;
  }>(
    `select m.id, m.role, m.content, m.metadata,
            a.slug as answer_slug, a.question as answer_question,
            a.reviewed_by, a.reviewed_at
       from messages m
       left join answers a on a.id = m.answer_id
      where m.conversation_id = $1
      order by m.created_at`,
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
        translations: [],
      });
    }
    sourcesByMessage.set(row.message_id, sources);
  }

  // One pass over every chunk in the thread rather than one per message: a
  // reloaded conversation must come back with the same English a live one had.
  await attachTranslations([...sourcesByMessage.values()].flat());

  // A miss quotes nothing, so it has no `message_citations` rows and its
  // passages would come back empty. They are recorded on the message metadata
  // instead; look them up the same way, so a reopened miss still shows what it
  // showed the first time.
  const missChunkIds = [
    ...new Set(messages.flatMap((m) => m.metadata?.retrievedChunkIds ?? [])),
  ];
  const missSources = new Map<number, Source>();
  if (missChunkIds.length > 0) {
    const rows = await query<{
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
      `select c.id as chunk_id, c.kind,
              ${REF_COLUMNS},
              d.permalink, d.arabic_text, d.english_text,
              s.title as source_title, s.attribution
         from chunks    c
         join documents d on d.id = c.document_id
         join sources   s on s.id = c.source_id
        where c.id = any($1::bigint[])`,
      [missChunkIds],
    );
    for (const row of rows) {
      missSources.set(Number(row.chunk_id), {
        chunkId: Number(row.chunk_id),
        canonicalRef: row.canonical_ref,
        kind: row.kind,
        sourceTitle: row.source_title,
        permalink: row.permalink,
        arabicText: row.arabic_text,
        englishText: row.english_text,
        attribution: row.attribution,
        chapterLevel: row.chapter_level,
        translations: [],
      });
    }
    await attachTranslations([...missSources.values()]);
  }

  return messages.map((m): ChatMessage => {
    // Without this the flag is lost on reload, `matched` reads as undefined,
    // and the client renders "no reviewed answer yet" inside the same frame
    // it uses for reviewed answers — the one confusion this whole design
    // exists to prevent. Assistant turns predate the flag only in rows
    // written before it was stored, which are treated as matches because
    // that is what they were.
    const matched =
      m.role === "assistant" ? (m.metadata?.matched ?? true) : undefined;

    const stored = (m.metadata?.retrievedChunkIds ?? [])
      .map((cid) => missSources.get(cid))
      .filter((s): s is Source => s !== undefined);

    return {
      id: m.id,
      role: m.role,
      content: m.content,
      matched,
      answer: m.answer_slug
        ? {
            slug: m.answer_slug,
            // Non-null whenever the slug is: both come from the same joined row.
            question: m.answer_question ?? m.answer_slug,
            reviewedBy: m.reviewed_by,
            reviewedAt: m.reviewed_at?.toISOString() ?? null,
            score: m.metadata?.matchScore,
          }
        : undefined,
      alternatives: m.metadata?.alternatives ?? [],
      confident: m.metadata?.confident ?? true,
      citations: citationsByMessage.get(m.id) ?? [],
      sources: sourcesByMessage.get(m.id) ?? stored,
    };
  });
}
