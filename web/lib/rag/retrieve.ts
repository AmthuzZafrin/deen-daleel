/**
 * Hybrid retrieval: vector + lexical, fused, balanced, reranked.
 *
 * The two arms fail in different directions, which is why both are needed:
 * embeddings catch "can I shorten prayers on a journey" against text that never
 * uses those words, while lexical search catches an exact hadith number or a
 * technical term (`istihadah`, `mash`) that the embedding smooths away.
 */

import { query, toVectorLiteral } from "../db";
import { embedQuery, rerank, OFFLINE } from "./embed";
import { glossQuery, type GlossLayers } from "./glossary";
import { hasArabic, normalizeQuery } from "./normalizeAr";
import { REF_COLUMNS } from "./refs";

export type SourceKind = "quran" | "hadith" | "tafsir" | "fiqh";

export interface RetrievedChunk {
  chunkId: number;
  documentId: number;
  sourceId: string;
  sourceTitle: string;
  kind: SourceKind;
  canonicalRef: string;
  chapterLevel: boolean;
  content: string;
  arabicText: string | null;
  englishText: string | null;
  permalink: string | null;
  metadata: Record<string, unknown>;
  attribution: string | null;
  fusionScore: number;
  rerankScore?: number;
}

export interface RetrieveOptions {
  /** Candidates pulled from each arm before fusion. */
  perArm?: number;
  /** Chunks handed to the model. */
  topK?: number;
  kinds?: SourceKind[];
  /**
   * Which glossary layers to expand the query with. The app always wants
   * `full`; `english-only` drops the Arabic chapter vocabulary and exists so
   * that layer's effect can be measured against the same corpus.
   */
  gloss?: GlossLayers;
}

/**
 * Reciprocal Rank Fusion constant. 60 is the value from the original RRF paper
 * and is deliberately large: it flattens the difference between rank 1 and
 * rank 5, so a passage both arms rank *moderately* well outranks one that a
 * single arm loves. That is the behaviour we want — agreement across two
 * dissimilar retrievers is a stronger signal than confidence from either.
 */
const RRF_K = 60;

/**
 * Floors that survive balancing, applied before reranking.
 *
 * Fiqh and tafsir are prose and vastly outnumber the Qur'an and hadith by
 * token count, so unbalanced fusion buries the primary evidence under
 * commentary about it. An answer that cites four fiqh manuals and no ayah is
 * not daleel, so the primary sources get reserved slots.
 */
const KIND_FLOOR: Record<SourceKind, number> = {
  quran: 4,
  hadith: 4,
  tafsir: 2,
  fiqh: 3,
};

/**
 * node-postgres returns bigint columns as strings (to avoid silently losing
 * precision above 2^53), so `chunk_id` and `rank` arrive as text. Every arm
 * coerces at the boundary via `toRanked` — mixing the two representations makes
 * Map lookups miss and silently yields zero results.
 */
interface RankedRow {
  chunk_id: string | number;
  rank: string | number;
}

interface Ranked {
  chunkId: number;
  rank: number;
}

function toRanked(rows: RankedRow[]): Ranked[] {
  return rows.map((r) => ({
    chunkId: Number(r.chunk_id),
    rank: Number(r.rank),
  }));
}

async function vectorArm(
  vector: number[] | null,
  limit: number,
  kinds?: SourceKind[],
): Promise<Ranked[]> {
  if (!vector) return [];

  // Rank *within each kind*, not globally.
  //
  // A global top-N is dominated by whichever kind shares the query's language.
  // Measured on "actions are judged by intentions": hadith is 23,946 chunks
  // against the Qur'an's 6,236, yet only 1 of the global top 40 was hadith —
  // because the Qur'an carries an English translation and the classical corpus
  // is Arabic only, so English queries land nearer the Qur'an whatever the
  // subject. The correct hadith was in the corpus and simply never became a
  // candidate, which no amount of downstream reranking can repair.
  //
  // Partitioning gives every kind its own shortlist; fusion and the reranker
  // then decide between them on merit rather than on which language the asker
  // happened to use.
  const perKind = Math.max(8, Math.ceil(limit / 2));

  return toRanked(
    await query<RankedRow>(
      `with ranked as (
         select id as chunk_id,
                kind,
                row_number() over (
                  partition by kind order by embedding <=> $1::vector
                ) as kind_rank,
                embedding <=> $1::vector as distance
           from chunks
          where ($3::text[] is null or kind = any($3))
       )
       select chunk_id,
              row_number() over (order by distance) as rank
         from ranked
        where kind_rank <= $4
        order by distance
        limit $2`,
      [toVectorLiteral(vector), limit, kinds ?? null, perKind],
    ),
  );
}

async function lexicalArm(
  text: string,
  limit: number,
  kinds?: SourceKind[],
): Promise<Ranked[]> {
  // `plainto_tsquery` ANDs every term, so a natural-language question only
  // matches a passage containing *all* of its words — which for questions like
  // "establish prayer and give charity to the poor" is essentially never, even
  // when the relevant verses are right there.
  //
  // Instead, stem the question into lexemes and OR them, letting `ts_rank_cd`
  // order by how many matched and how close together they are. That makes this
  // arm high-recall, which is its job; RRF and the reranker supply precision.
  //
  // The query is built inside SQL from a bound parameter, so no user text is
  // ever concatenated into a tsquery expression.
  return toRanked(
    await query<RankedRow>(
      `with lex as (
         select array_to_string(
                  tsvector_to_array(to_tsvector('english', $1)), ' | '
                ) as expr
       ),
       q as (
         select to_tsquery('english', expr) as tsq
           from lex
          where expr <> ''
       )
       select c.id as chunk_id,
              row_number() over (order by ts_rank_cd(c.tsv, q.tsq) desc, c.id) as rank
         from chunks c, q
        where c.tsv @@ q.tsq
          and ($3::text[] is null or c.kind = any($3))
        order by ts_rank_cd(c.tsv, q.tsq) desc, c.id
        limit $2`,
      [text, limit, kinds ?? null],
    ),
  );
}

/**
 * Arabic arm. Only runs when the query actually contains Arabic script, so the
 * common English question pays nothing for it.
 */
async function arabicArm(
  normalized: string,
  limit: number,
  kinds?: SourceKind[],
): Promise<Ranked[]> {
  return toRanked(
    await query<RankedRow>(
      `select id as chunk_id,
            row_number() over (order by similarity(text_ar_norm, $1) desc) as rank
       from chunks
      where text_ar_norm % $1
        and ($3::text[] is null or kind = any($3))
      order by similarity(text_ar_norm, $1) desc
      limit $2`,
      [normalized, limit, kinds ?? null],
    ),
  );
}

function fuse(arms: Ranked[][]): Map<number, number> {
  const scores = new Map<number, number>();
  for (const arm of arms) {
    for (const { chunkId, rank } of arm) {
      scores.set(chunkId, (scores.get(chunkId) ?? 0) + 1 / (RRF_K + rank));
    }
  }
  return scores;
}

/**
 * Take the best candidates while guaranteeing each kind its floor.
 *
 * Fills the reserved slots first, then lets the remaining budget go to whatever
 * scored highest regardless of kind — so balancing sets a minimum for primary
 * evidence without capping a question that genuinely is all fiqh.
 */
function balance(
  ordered: RetrievedChunk[],
  budget: number,
): RetrievedChunk[] {
  const picked: RetrievedChunk[] = [];
  const taken = new Set<number>();

  for (const [kind, floor] of Object.entries(KIND_FLOOR) as [
    SourceKind,
    number,
  ][]) {
    let n = 0;
    for (const chunk of ordered) {
      if (n >= floor || picked.length >= budget) break;
      if (chunk.kind !== kind || taken.has(chunk.chunkId)) continue;
      picked.push(chunk);
      taken.add(chunk.chunkId);
      n++;
    }
  }

  for (const chunk of ordered) {
    if (picked.length >= budget) break;
    if (taken.has(chunk.chunkId)) continue;
    picked.push(chunk);
    taken.add(chunk.chunkId);
  }

  // Order by rerank score once every pick has one — it is the better signal
  // within a language. Before reranking, and in offline mode, no chunk carries
  // one and fusion order stands. Mixing the two scales would be worse than
  // either, so it is all-or-nothing.
  const allReranked = picked.every((c) => c.rerankScore !== undefined);
  return picked.sort((a, b) =>
    allReranked
      ? (b.rerankScore ?? 0) - (a.rerankScore ?? 0)
      : b.fusionScore - a.fusionScore,
  );
}

async function hydrate(chunkIds: number[]): Promise<Map<number, RetrievedChunk>> {
  if (chunkIds.length === 0) return new Map();

  const rows = await query<Record<string, never>>(
    `select c.id            as chunk_id,
            c.document_id   as document_id,
            c.source_id     as source_id,
            c.kind          as kind,
            c.content       as content,
            ${REF_COLUMNS},
            d.arabic_text   as arabic_text,
            d.english_text  as english_text,
            d.permalink     as permalink,
            d.metadata      as metadata,
            s.title         as source_title,
            s.attribution   as attribution
       from chunks c
       join documents d on d.id = c.document_id
       join sources   s on s.id = c.source_id
      where c.id = any($1)`,
    [chunkIds],
  );

  const out = new Map<number, RetrievedChunk>();
  for (const r of rows as unknown as Record<string, unknown>[]) {
    out.set(Number(r.chunk_id), {
      chunkId: Number(r.chunk_id),
      documentId: Number(r.document_id),
      sourceId: String(r.source_id),
      sourceTitle: String(r.source_title),
      kind: r.kind as SourceKind,
      canonicalRef: String(r.canonical_ref),
      chapterLevel: Boolean(r.chapter_level),
      content: String(r.content),
      arabicText: (r.arabic_text as string) ?? null,
      englishText: (r.english_text as string) ?? null,
      permalink: (r.permalink as string) ?? null,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      attribution: (r.attribution as string) ?? null,
      fusionScore: 0,
    });
  }
  return out;
}

export async function retrieve(
  userQuery: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const perArm = options.perArm ?? 40;
  const topK = options.topK ?? 12;

  // Gloss Islamic terms into the wording Pickthall's translation uses before
  // anything else sees the query. Without it "what is riba" reaches none of the
  // four verses on riba, because the only English in the corpus calls it usury.
  // See lib/rag/glossary.ts — the terms are added, never substituted.
  const expanded = glossQuery(userQuery, options.gloss ?? "full");
  const normalized = normalizeQuery(expanded);

  // Embed the *normalised* query, not the raw one. The corpus is embedded from
  // a diacritic-folded projection (see Chunk.embed_text in ingest/db.py), so an
  // Arabic query carrying vocalisation marks would be compared against text
  // that has none — measurably worse, and silently so. English is unaffected:
  // normalizeQuery only touches Arabic.
  const vector = await embedQuery(normalized);

  const arms = await Promise.all([
    vectorArm(vector, perArm, options.kinds),
    // The lexical arm searches English text, so it wants the glossed form —
    // 'usury' is the token that exists in the index, 'riba' is not.
    lexicalArm(expanded, perArm, options.kinds),
    // The trigram arm searches Arabic, where the gloss is only noise. It gets
    // the original query, folded.
    hasArabic(userQuery)
      ? arabicArm(normalizeQuery(userQuery), perArm, options.kinds)
      : Promise.resolve<Ranked[]>([]),
  ]);

  const fused = fuse(arms);
  if (fused.size === 0) return [];

  const hydrated = await hydrate([...fused.keys()]);

  const ordered = [...fused.entries()]
    .map(([chunkId, score]) => {
      const chunk = hydrated.get(chunkId);
      return chunk ? { ...chunk, fusionScore: score } : null;
    })
    .filter((c): c is RetrievedChunk => c !== null)
    .sort((a, b) => b.fusionScore - a.fusionScore);

  // Rerank a widened, balanced candidate set rather than the final topK, so the
  // reranker has genuine choice instead of merely reordering a decided answer.
  const candidates = balance(ordered, Math.min(ordered.length, topK * 3));

  // Score every candidate, not just topK. The reranker evaluates all pairs
  // regardless — `top_k` only truncates the response — so asking for fewer
  // costs nothing and hides candidates that the balancing below still needs to
  // reach each kind's floor.
  // Rerank against the glossed query too. The reranker has the same vocabulary
  // problem as the retriever: asked about 'riba' it scores the verses on riba
  // near zero, because nothing in their English says riba.
  const results = await rerank(
    expanded,
    candidates.map((c) => c.content),
    candidates.length,
  );

  const reranked: RetrievedChunk[] = [];
  for (const { index, score } of results) {
    const chunk = candidates[index];
    if (!chunk) continue;
    // In offline mode the reranker is a passthrough and every score is 0, so
    // leave rerankScore unset rather than implying a judgement was made.
    reranked.push(OFFLINE ? chunk : { ...chunk, rerankScore: score });
  }

  // Balance again, *after* reranking, not only before it.
  //
  // Reranking is unreliable across languages, and most of this corpus is
  // Arabic-only. Measured on "actions are judged by intentions": the vector arm
  // ranks the correct Bukhari chapter — literally «باب ما جاء أن الأعمال
  // بالنية» — 4th in the whole corpus, while the reranker scores it 0.006
  // against 0.917 for the same query asked in Arabic. Balancing only before the
  // rerank lets it discard every hadith afterwards, so an English question
  // returned Qur'an alone even when the hadith answering it was sitting right
  // there.
  //
  // This restores each kind's floor from candidates that already survived
  // fusion, so it reinstates evidence that was retrieved rather than inventing
  // relevance. A kind with no candidates still contributes nothing.
  return balance(reranked, topK);
}
