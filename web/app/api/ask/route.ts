/**
 * The runtime lookup. **No Anthropic API call happens here.**
 *
 * A question is matched against published, human-reviewed answers. On a match,
 * the stored answer and its source passages are returned verbatim. On a miss,
 * relevant corpus passages are returned with an honest "not covered yet", and
 * the question is logged so it can be written and reviewed later.
 *
 * This endpoint must keep working with `ANTHROPIC_API_KEY` unset. If it ever
 * stops, something has crept back into the request path that does not belong.
 */

import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { query } from "@/lib/db";
import { logQuery, matchAnswer } from "@/lib/rag/answers";
import { retrieve } from "@/lib/rag/retrieve";
import { getOrCreateSessionId } from "@/lib/session";
import type { Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AskRequest {
  question: string;
  conversationId?: string;
}

export async function POST(req: NextRequest) {
  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }
  if (question.length > 1000) {
    return Response.json({ error: "question is too long" }, { status: 400 });
  }

  const { sessionId, setCookie } = await getOrCreateSessionId();

  // --- conversation bookkeeping -------------------------------------------

  let conversationId = body.conversationId;
  if (conversationId) {
    const owned = await query<{ id: string }>(
      `select id from conversations where id = $1 and user_id = $2`,
      [conversationId, sessionId],
    );
    if (owned.length === 0) {
      return Response.json({ error: "conversation not found" }, { status: 404 });
    }
  } else {
    conversationId = randomUUID();
    await query(
      `insert into conversations (id, user_id, title) values ($1, $2, $3)`,
      [conversationId, sessionId, question.slice(0, 80)],
    );
  }

  await query(
    `insert into messages (id, conversation_id, role, content) values ($1,$2,'user',$3)`,
    [randomUUID(), conversationId, question],
  );

  // --- match ---------------------------------------------------------------

  const result = await matchAnswer(question);

  // Logging is best-effort: a failure to record analytics must never cost the
  // reader their answer.
  try {
    await logQuery(question, result, sessionId);
  } catch (err) {
    console.error("query_log write failed:", err);
  }

  const assistantMessageId = randomUUID();
  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) headers.append("set-cookie", setCookie);

  if (result.answer) {
    await query(
      `insert into messages (id, conversation_id, role, content, answer_id, metadata)
       values ($1,$2,'assistant',$3,$4,$5)`,
      [
        assistantMessageId,
        conversationId,
        result.answer.body,
        result.answer.answerId,
        JSON.stringify({ matchScore: result.answer.score }),
      ],
    );

    for (const c of result.answer.citations) {
      await query(
        `insert into message_citations (message_id, chunk_id, ordinal, cited_text)
         values ($1,$2,$3,$4)`,
        [assistantMessageId, c.chunkId, c.ordinal, c.citedText],
      );
    }

    await query(`update conversations set updated_at = now() where id = $1`, [
      conversationId,
    ]);

    return Response.json(
      {
        conversationId,
        messageId: assistantMessageId,
        matched: true,
        answer: {
          slug: result.answer.slug,
          question: result.answer.question,
          body: result.answer.body,
          reviewedBy: result.answer.reviewedBy,
          reviewedAt: result.answer.reviewedAt,
          score: result.answer.score,
        },
        citations: result.answer.citations,
        sources: result.answer.sources,
      },
      { headers },
    );
  }

  // --- miss: give them the sources anyway ----------------------------------

  // Being told "no reviewed answer yet, but here is what the Qur'an says on
  // this" is genuinely useful, and far better than a fluent guess.
  let passages: Source[] = [];
  try {
    const chunks = await retrieve(question, { topK: 6 });
    passages = chunks.map((c) => ({
      chunkId: c.chunkId,
      canonicalRef: c.canonicalRef,
      kind: c.kind,
      sourceTitle: c.sourceTitle,
      permalink: c.permalink,
      arabicText: c.arabicText,
      englishText: c.englishText,
      attribution: c.attribution,
      chapterLevel: c.chapterLevel,
    }));
  } catch (err) {
    console.error("fallback retrieval failed:", err);
  }

  const note =
    passages.length > 0
      ? "We don't have a reviewed answer for this yet. These passages came up as " +
        "relevant — read them as source material, not as an answer to your question."
      : "We don't have a reviewed answer for this yet, and nothing in the sources " +
        "we hold came up as clearly relevant. Try rephrasing, or ask a scholar directly.";

  await query(
    `insert into messages (id, conversation_id, role, content, metadata)
     values ($1,$2,'assistant',$3,$4)`,
    [
      assistantMessageId,
      conversationId,
      note,
      JSON.stringify({ matched: false, topScore: result.topScore }),
    ],
  );

  await query(`update conversations set updated_at = now() where id = $1`, [
    conversationId,
  ]);

  return Response.json(
    {
      conversationId,
      messageId: assistantMessageId,
      matched: false,
      note,
      citations: [],
      sources: passages,
    },
    { headers },
  );
}
