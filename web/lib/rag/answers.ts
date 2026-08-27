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
export const MATCH_THRESHOLD = Number(process.env.DEEN_MATCH_THRESHOLD ?? 0.1);

/**
 * How far the query may sit from the nearest stored phrasing and still be
 * treated as a question the bank covers.
 *
 * This is the gate the reranker score was doing badly. The two signals are not
 * the same kind of number. The reranker is a cross-encoder scoring relevance
 * between a query and a document, and on this eval set its output for questions
 * the bank *does* answer ranged from 0.019 to 1.000 — a correct top answer at
 * 0.019 and another at 0.994, with no way to tell from the number which was
 * which. A question the bank has nothing for reached 0.159. Overlapping ranges
 * cannot be separated by a threshold, so every setting of one either threw away
 * correct answers or served wrong ones.
 *
 * Cosine distance behaves: bounded, meaning the same thing for every query, and
 * indifferent to sentence form. Measured over the same 89 questions, everything
 * the bank answers sat at or below 0.337, and the two questions genuinely
 * outside it — deepfakes, shorting oil — sat at 0.382 and 0.414. So distance
 * answers "do we hold anything close to this", the reranker answers "which of
 * these", and neither is asked the other's question.
 *
 * The remaining rerank floor is deliberately low. It is no longer the gate; it
 * only catches the case where the bank holds something on roughly this subject
 * but nothing that is an answer to *this*.
 */
export const MAX_MATCH_DISTANCE = Number(process.env.DEEN_MAX_MATCH_DISTANCE ?? 0.32);

/**
 * A rerank score high enough to overrule the distance gate.
 *
 * The gate asks whether the bank holds anything near this question, and answers
 * with an embedding, which is the wrong instrument for a spelling. "what is
 * laylatul qadr" sits 0.336 from the nearest phrasing — outside the gate — while
 * the cross-encoder scores the Laylat al-Qadr answer at 0.965, because it can
 * see that the two strings are the same words. Vetoing that is the gate
 * overreaching: it exists to catch questions the bank does not cover, not to
 * second-guess a near-certain identification.
 *
 * The bar is set far above anything a question outside the bank reached in
 * testing — the highest was 0.159 — so it takes near-certainty, not confidence,
 * to use it.
 */
const DISTANCE_OVERRIDE_SCORE = Number(process.env.DEEN_DISTANCE_OVERRIDE ?? 0.9);

/**
 * How close a runner-up must be before the reader is told it exists.
 *
 * The reranker orders answers well and calibrates them badly. Across the eval
 * set its top score sat anywhere from 0.04 to 0.999 on questions it got right,
 * so the absolute number says little — but the *gap* to the second answer says
 * a great deal, and the gap is where the dangerous failures live. "can i wipe
 * over my socks" scored `wiping-over-shoes` at 0.9990 and `wiping-over-socks`
 * at 0.9980: a coin flip between two different rulings, served as a settled
 * answer. "can a muslim girl marry a christian" led with the ruling for a
 * Muslim *man*, whose answer is the opposite one, by 0.10.
 *
 * Below this gap the second answer is not a worse answer, it is a different
 * question that the matcher could not tell apart — so the reader is shown it
 * and decides, since a human reading two questions side by side settles in a
 * second what the cross-encoder could not settle at all.
 *
 * Tuned on 89 real-world phrasings in `evals/`, which is few enough that this
 * is a starting value. `query_log` is the instrument for retuning it.
 */
export const MATCH_MARGIN = Number(process.env.DEEN_MATCH_MARGIN ?? 0.05);

/** At most this many near-ties are offered; past three it is a list, not a choice. */
const MAX_ALTERNATIVES = 3;

/** Fusion constant, matching retrieve.ts. */
const RRF_K = 60;

/** How many answers the reranker is asked to judge. */
const CANDIDATE_LIMIT = 20;

/**
 * Vector-arm hits that enter the candidate set regardless of what fusion made
 * of them. Question-to-question similarity is the signal this matcher is built
 * on; fusion must not be able to evict it.
 */
const VECTOR_FLOOR = 8;

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

/** A near-tied answer the matcher could not rule out. */
export interface Alternative {
  slug: string;
  question: string;
  score: number;
}

export interface MatchResult {
  answer: MatchedAnswer | null;
  /** Best score seen, even when below threshold — logged to measure near-misses. */
  topScore: number | null;
  topAnswerId: number | null;
  /**
   * Other answers within `MATCH_MARGIN` of the one served. Empty when the
   * matcher was confident, which is the common case.
   */
  alternatives: Alternative[];
}

interface RankedRow {
  answer_id: string | number;
  rank: string | number;
  distance?: string | number;
}

function toRanked(rows: RankedRow[]) {
  return rows.map((r) => ({
    answerId: Number(r.answer_id),
    rank: Number(r.rank),
    /** Cosine distance, on the vector arm only; the lexical arm has none. */
    distance: r.distance === undefined ? null : Number(r.distance),
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
       select answer_id, distance,
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

/** One answer's best showing against the query, and the phrasing that earned it. */
export interface AnswerScore {
  answerId: number;
  slug: string;
  score: number;
  /** The phrasing that scored best — the reason this answer placed where it did. */
  phrasing: string;
}

/**
 * The whole ladder, every rung visible.
 *
 * `matchAnswer` used to collapse all of this into one number and one id, which
 * meant that when it served the wrong answer there was no way to ask *where* it
 * went wrong — whether the right answer never reached the reranker or reached it
 * and lost. The diagnostic that answered that question started as a second copy
 * of the pipeline in `scripts/whyMatch.ts`, and a copy drifts: it kept the old
 * candidate rule after this file changed and confidently reported a stale
 * verdict. So the ranking is exported and both callers read the same rungs.
 */
export interface Ranking {
  vec: { answerId: number; rank: number; distance: number | null }[];
  lex: { answerId: number; rank: number; distance: number | null }[];
  /**
   * Cosine distance from the query to the single closest stored phrasing in the
   * whole published bank — how near this question comes to anything we hold,
   * independent of which answer wins. `null` only when the embedding service is
   * unavailable.
   */
  topDistance: number | null;
  fused: { answerId: number; rrf: number }[];
  candidateIds: number[];
  /** Every phrasing of every candidate, best first. */
  perPhrasing: AnswerScore[];
  /** One row per candidate, its best phrasing only, best first. */
  answers: AnswerScore[];
}

export async function rankAnswers(userQuery: string): Promise<Ranking | null> {
  // Normalised before embedding, to match how the corpus and the stored
  // phrasings were embedded. See the note in retrieve.ts.
  const vector = await embedQuery(normalizeQuery(userQuery));

  const [vec, lex] = await Promise.all([
    vectorArm(vector, 25),
    lexicalArm(userQuery, 25),
  ]);

  const fusedScores = new Map<number, number>();
  for (const arm of [vec, lex]) {
    for (const { answerId, rank } of arm) {
      fusedScores.set(answerId, (fusedScores.get(answerId) ?? 0) + 1 / (RRF_K + rank));
    }
  }
  if (fusedScores.size === 0) return null;

  const fused = [...fusedScores.entries()]
    .map(([answerId, rrf]) => ({ answerId, rrf }))
    .sort((a, b) => b.rrf - a.rrf);

  // The candidate set is a recall net, not a ranking. The reranker is the judge
  // of which answer fits; RRF's only job here is to keep the net small enough to
  // afford. Judged as a ranking it fails in a way that is easy to miss: the
  // lexical arm scores by how many query lexemes matched, with no notion of how
  // common those lexemes are, so "what does islam say about ivf" scores every
  // answer phrased "what does Islam say about ..." above the one that actually
  // says IVF. Fused with a rank from each arm, that noise outranked a vector hit
  // sitting at position 2 and the IVF answer never reached the reranker at all.
  //
  // So the vector arm's best hits go in unconditionally, whatever fusion made of
  // them, and the net is wider than the ten it used to be. Both cost only
  // reranker time, and being cheap is not the property that matters here.
  const candidateIds = [
    ...new Set([
      ...vec.slice(0, VECTOR_FLOOR).map((r) => r.answerId),
      ...fused.map((f) => f.answerId),
    ]),
  ].slice(0, CANDIDATE_LIMIT);

  // Rerank against *every* phrasing of each candidate, scoring an answer by its
  // best-matching one.
  //
  // Reranking only the primary phrasing would throw away the paraphrases, which
  // are the entire reason they are stored: a question that matches a paraphrase
  // word for word would still be scored against a differently-worded primary
  // and could fall under the threshold. Scoring per phrasing and taking the max
  // means an answer is judged on its closest statement of the question, not on
  // whichever one happened to be marked primary.
  const phrasings = await query<{
    answer_id: string;
    text: string;
    slug: string;
    question: string;
  }>(
    `select aq.answer_id, aq.text, a.slug, a.question
       from answer_questions aq
       join answers a on a.id = aq.answer_id
      where aq.answer_id = any($1)`,
    [candidateIds],
  );
  if (phrasings.length === 0) return null;

  // Each phrasing is reranked with its answer's own question in front of it.
  //
  // A phrasing on its own is six or eight words, and bge-reranker-v2-m3 was
  // trained to score a query against a passage. Handed two short questions it
  // leans on sentence *form* far more than on subject, which is measurable
  // against the service directly: "is vanilla extract haram" scores 0.999
  // against "Is vanilla extract haram because of the alcohol?" while "what
  // about vanilla extract" scores 0.040 against the identical phrasing, and
  // "can i get a tattoo" scores "Are piercings allowed?" (0.849) above "can
  // Muslims get tattoos" (0.501). Same subject scored low, wrong subject scored
  // high, on nothing but the shape of the sentence.
  //
  // Prefixing the primary question roughly doubles the document and gives the
  // subject nouns somewhere to appear twice. Across the eval set it left both
  // the number of questions answered correctly and the number answered wrongly
  // unchanged, but moved 20 of them from "here are two questions, which did you
  // mean" to a direct answer — the same accuracy asked of the reader far less
  // often. Longer documents were also tried, up to 500 characters of answer
  // body; they raised direct answers further and lost more questions to the
  // threshold than they gained. See `scripts/tuneRerankDoc.ts`, which is the
  // experiment, kept so the next person can rerun it rather than trust this.
  const docs = phrasings.map((p) =>
    p.text === p.question ? p.text : `${p.question} ${p.text}`,
  );
  const ranked = await rerank(userQuery, docs, docs.length);

  const perPhrasing: AnswerScore[] = [];
  for (const r of ranked) {
    const p = phrasings[r.index];
    if (!p) continue;
    perPhrasing.push({
      answerId: Number(p.answer_id),
      slug: p.slug,
      score: r.score,
      phrasing: p.text,
    });
  }
  perPhrasing.sort((a, b) => b.score - a.score);

  const bestBy = new Map<number, AnswerScore>();
  for (const p of perPhrasing) {
    if (!bestBy.has(p.answerId)) bestBy.set(p.answerId, p);
  }
  const answers = [...bestBy.values()].sort((a, b) => b.score - a.score);

  return { vec, lex, topDistance: vec[0]?.distance ?? null, fused, candidateIds, perPhrasing, answers };
}

export async function matchAnswer(userQuery: string): Promise<MatchResult> {
  const none = { answer: null, topScore: null, topAnswerId: null, alternatives: [] };

  const ranking = await rankAnswers(userQuery);
  if (!ranking || ranking.answers.length === 0) return none;

  const top = ranking.answers[0];

  // Offline mode has no reranker, so there is no meaningful score to threshold
  // against. Refuse to match rather than serve on a score of zero — a wrong
  // published answer is worse than an honest miss.
  if (OFFLINE) return { ...none, topAnswerId: top.answerId };

  // Nothing in the bank is close enough to this question for any answer to be
  // an answer to it — unless the reranker is near-certain, which it can be when
  // the difference is a transliteration the embedding treats as a different word.
  const tooFar =
    ranking.topDistance !== null && ranking.topDistance > MAX_MATCH_DISTANCE;
  if (tooFar && top.score < DISTANCE_OVERRIDE_SCORE) {
    return { ...none, topScore: top.score, topAnswerId: top.answerId };
  }

  if (top.score < MATCH_THRESHOLD) {
    return { ...none, topScore: top.score, topAnswerId: top.answerId };
  }

  const answer = await hydrate(top.answerId);
  if (!answer) {
    return { ...none, topScore: top.score, topAnswerId: top.answerId };
  }

  // Everything the matcher could not separate from the answer it chose. These
  // are not "related reading" — they are the questions it might have meant
  // instead, and the reader is the one equipped to tell.
  const near = ranking.answers
    .slice(1)
    .filter((a) => top.score - a.score < MATCH_MARGIN)
    .slice(0, MAX_ALTERNATIVES);

  let alternatives: Alternative[] = [];
  if (near.length > 0) {
    const rows = await query<{ id: string; slug: string; question: string }>(
      `select id, slug, question from answers
        where id = any($1) and status = 'published'`,
      [near.map((a) => a.answerId)],
    );
    const byId = new Map(rows.map((r) => [Number(r.id), r]));
    alternatives = near.flatMap((a) => {
      const row = byId.get(a.answerId);
      return row ? [{ slug: row.slug, question: row.question, score: a.score }] : [];
    });
  }

  return {
    answer: { ...answer, score: top.score },
    topScore: top.score,
    topAnswerId: top.answerId,
    alternatives,
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
