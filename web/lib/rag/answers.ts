/**
 * Runtime answer matching. **Makes no Anthropic API call.**
 *
 * A user's question is matched against the phrasings of *published* answers
 * (`answer_questions`), not against the corpus. Question-to-question matching is
 * far more reliable than matching a question against answer prose or raw
 * scripture: the shapes are alike, so the embedding comparison is doing the
 * thing it is good at.
 *
 * When nothing clears the threshold the caller gets `null` and falls back to
 * showing relevant source passages, which is honest — "here is what the sources
 * say, we haven't written a reviewed answer for this yet" — rather than serving
 * an answer to a question nobody actually wrote.
 */

import { query, toVectorLiteral } from "../db";
import { embedQuery, rerank, OFFLINE } from "./embed";
import { normalizeQuery } from "./normalizeAr";
import { REF_COLUMNS } from "./refs";
import type { Citation, Source } from "../types";

/**
 * Minimum rerank relevance for a match to be served.
 *
 * A starting guess, to be tuned from `query_log`: too low serves a confident
 * answer to a question it does not address, which in this domain is the
 * expensive direction to be wrong in; too high buries good answers behind a
 * "not covered" message. Prefer erring high — an honest miss costs a reader
 * nothing, a wrong answer costs them their trust.
 */
export const MATCH_THRESHOLD = Number(process.env.DEEN_MATCH_THRESHOLD ?? 0.5);

/** Fusion constant, matching retrieve.ts. */
const RRF_K = 60;

export interface MatchedAnswer {
  answerId: number;
  slug: string;
  question: string;
  body: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  citations: Citation[];
  sources: Source[];
  score: number;
}

export interface MatchResult {
  answer: MatchedAnswer | null;
  /** Best score seen, even when below threshold — logged to measure near-misses. */
  topScore: number | null;
  topAnswerId: number | null;
}

interface RankedRow {
  answer_id: string | number;
  rank: string | number;
}

function toRanked(rows: RankedRow[]) {
  return rows.map((r) => ({
    answerId: Number(r.answer_id),
    rank: Number(r.rank),
  }));
}

/**
 * Vector arm over question phrasings.
 *
 * `distinct on (answer_id)` keeps only each answer's best-matching phrasing, so
 * an answer with eight paraphrases does not crowd out one with two.
 */
async function vectorArm(vector: number[] | null, limit: number) {
  if (!vector) return [];
  return toRanked(
    await query<RankedRow>(
      `with best as (
         select distinct on (aq.answer_id)
                aq.answer_id,
                aq.embedding <=> $1::vector as distance
           from answer_questions aq
           join answers a on a.id = aq.answer_id
          where a.status = 'published'
          order by aq.answer_id, aq.embedding <=> $1::vector
       )
       select answer_id,
              row_number() over (order by distance) as rank
         from best
        order by distance
        limit $2`,
      [toVectorLiteral(vector), limit],
    ),
  );
}

/** Lexical arm. ORs stemmed lexemes, as in retrieve.ts and for the same reason. */
async function lexicalArm(text: string, limit: number) {
  return toRanked(
    await query<RankedRow>(
      `with lex as (
         select array_to_string(
                  tsvector_to_array(to_tsvector('english', $1)), ' | '
                ) as expr
       ),
       q as (
         select to_tsquery('english', expr) as tsq from lex where expr <> ''
       ),
       best as (
         select aq.answer_id, max(ts_rank_cd(aq.tsv, q.tsq)) as score
           from answer_questions aq
           join answers a on a.id = aq.answer_id, q
          where a.status = 'published'
            and aq.tsv @@ q.tsq
          group by aq.answer_id
       )
       select answer_id,
              row_number() over (order by score desc) as rank
         from best
        order by score desc
        limit $2`,
      [text, limit],
    ),
  );
}

async function hydrate(answerId: number): Promise<MatchedAnswer | null> {
  const rows = await query<Record<string, unknown>>(
    `select a.id, a.slug, a.question, a.body,
            a.reviewed_by, a.reviewed_at, a.published_at
       from answers a
      where a.id = $1 and a.status = 'published'`,
    [answerId],
  );
  if (rows.length === 0) return null;
  const a = rows[0];

  // Join citations back to the chunk they point at, so the reader gets the
  // Arabic, the translation and the permalink — the whole point of the app.
  const citationRows = await query<Record<string, unknown>>(
    `select ac.ordinal, ac.cited_text,
            c.id as chunk_id, c.kind,
            ${REF_COLUMNS},
            d.permalink, d.arabic_text, d.english_text,
            s.title as source_title, s.attribution
       from answer_citations ac
       join chunks    c on c.id = ac.chunk_id
       join documents d on d.id = c.document_id
       join sources   s on s.id = c.source_id
      where ac.answer_id = $1
      order by ac.ordinal`,
    [answerId],
  );

  const citations: Citation[] = [];
  const sources: Source[] = [];

  for (const r of citationRows) {
    const chunkId = Number(r.chunk_id);
    citations.push({
      ordinal: Number(r.ordinal),
      chunkId,
      canonicalRef: String(r.canonical_ref),
      citedText: String(r.cited_text),
    });
    if (!sources.some((s) => s.chunkId === chunkId)) {
      sources.push({
        chunkId,
        canonicalRef: String(r.canonical_ref),
        kind: r.kind as Source["kind"],
        sourceTitle: String(r.source_title),
        permalink: (r.permalink as string) ?? null,
        arabicText: (r.arabic_text as string) ?? null,
        englishText: (r.english_text as string) ?? null,
        attribution: (r.attribution as string) ?? null,
        chapterLevel: Boolean(r.chapter_level),
      });
    }
  }

  const asIso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

  return {
    answerId,
    slug: String(a.slug),
    question: String(a.question),
    body: String(a.body),
    reviewedBy: (a.reviewed_by as string) ?? null,
    reviewedAt: asIso(a.reviewed_at),
    publishedAt: asIso(a.published_at),
    citations,
    sources,
    score: 0,
  };
}

export async function matchAnswer(userQuery: string): Promise<MatchResult> {
  // Normalised before embedding, to match how the corpus and the stored
  // phrasings were embedded. See the note in retrieve.ts.
  const vector = await embedQuery(normalizeQuery(userQuery));

  const [vec, lex] = await Promise.all([
    vectorArm(vector, 25),
    lexicalArm(userQuery, 25),
  ]);

  const fused = new Map<number, number>();
  for (const arm of [vec, lex]) {
    for (const { answerId, rank } of arm) {
      fused.set(answerId, (fused.get(answerId) ?? 0) + 1 / (RRF_K + rank));
    }
  }

  if (fused.size === 0) {
    return { answer: null, topScore: null, topAnswerId: null };
  }

  const candidateIds = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  // Rerank against *every* phrasing of each candidate, scoring an answer by its
  // best-matching one.
  //
  // Reranking only the primary phrasing would throw away the paraphrases, which
  // are the entire reason they are stored: a question that matches a paraphrase
  // word for word would still be scored against a differently-worded primary
  // and could fall under the threshold. Scoring per phrasing and taking the max
  // means an answer is judged on its closest statement of the question, not on
  // whichever one happened to be marked primary.
  const phrasings = await query<{ answer_id: string; text: string }>(
    `select answer_id, text from answer_questions where answer_id = any($1)`,
    [candidateIds],
  );
  if (phrasings.length === 0) {
    return { answer: null, topScore: null, topAnswerId: null };
  }

  const owners = phrasings.map((p) => Number(p.answer_id));
  const texts = phrasings.map((p) => p.text);

  const ranked = await rerank(userQuery, texts, texts.length);

  let topAnswerId: number | null = null;
  let best: { score: number } | null = null;
  for (const r of ranked) {
    const owner = owners[r.index];
    if (owner === undefined) continue;
    if (best === null || r.score > best.score) {
      best = { score: r.score };
      topAnswerId = owner;
    }
  }

  if (best === null || topAnswerId === null) {
    return { answer: null, topScore: null, topAnswerId: null };
  }

  // Offline mode has no reranker, so there is no meaningful score to threshold
  // against. Refuse to match rather than serve on a score of zero — a wrong
  // published answer is worse than an honest miss.
  if (OFFLINE) {
    return { answer: null, topScore: null, topAnswerId };
  }

  if (best.score < MATCH_THRESHOLD) {
    return { answer: null, topScore: best.score, topAnswerId };
  }

  const answer = await hydrate(topAnswerId);
  if (!answer) return { answer: null, topScore: best.score, topAnswerId };

  return {
    answer: { ...answer, score: best.score },
    topScore: best.score,
    topAnswerId,
  };
}

/** Record every question asked. Unmatched rows are the editorial work queue. */
export async function logQuery(
  queryText: string,
  result: MatchResult,
  sessionId: string | null,
): Promise<void> {
  await query(
    `insert into query_log (query_text, matched, top_answer_id, top_score, session_id)
     values ($1, $2, $3, $4, $5)`,
    [
      queryText,
      result.answer !== null,
      result.topAnswerId,
      result.topScore,
      sessionId,
    ],
  );
}
