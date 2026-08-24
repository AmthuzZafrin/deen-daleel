/**
 * Voyage AI: query embedding and reranking.
 *
 * Note `input_type: "query"` below. The corpus was embedded with
 * `input_type: "document"` (see ingest/embed.py) — Voyage applies a different
 * internal prompt to each side, and using the same value on both measurably
 * degrades retrieval. This asymmetry is easy to miss and produces no error.
 */

import { EMBEDDING_DIM, EMBEDDING_MODEL, RERANK_MODEL, env } from "../env";

const EMBED_PATH = "/embeddings";
const RERANK_PATH = "/rerank";

/**
 * Offline mode drops the vector arm of hybrid search and runs lexical-only.
 *
 * It deliberately does NOT fabricate a query vector: the corpus's offline
 * placeholder vectors come from Python's RNG, which cannot be reproduced here,
 * so a fake query vector would rank by pure noise. Lexical-only is degraded but
 * honest, and it lets the plumbing be exercised without an API key.
 */
export const OFFLINE = process.env.DEEN_OFFLINE === "1";

export class VoyageError extends Error {}

async function callVoyage(path: string, body: unknown): Promise<Response> {
  const url = `${env.voyageBaseUrl}${path}`;
  let delay = 1000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.voyageApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) return resp;

    // Retry rate limits and transient server errors; fail fast on anything else
    // (a 401 will not fix itself).
    if (resp.status === 429 || resp.status >= 500) {
      if (attempt === 3) {
        throw new VoyageError(
          `Voyage still failing after retries: ${resp.status} ${await resp.text()}`,
        );
      }
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    throw new VoyageError(`Voyage ${resp.status}: ${await resp.text()}`);
  }
  throw new VoyageError("unreachable");
}

export async function embedQuery(text: string): Promise<number[] | null> {
  if (OFFLINE) return null;

  const resp = await callVoyage(EMBED_PATH, {
    input: [text],
    model: EMBEDDING_MODEL,
    input_type: "query",
  });
  const json = (await resp.json()) as { data: { embedding: number[] }[] };
  const vec = json.data[0]?.embedding;

  if (!vec || vec.length !== EMBEDDING_DIM) {
    throw new VoyageError(
      `expected a ${EMBEDDING_DIM}-dim embedding from ${EMBEDDING_MODEL}, got ${vec?.length}`,
    );
  }
  return vec;
}

export interface RerankResult {
  index: number;
  score: number;
}

/**
 * Rerank candidates against the query, returning indices into `documents`
 * ordered best-first.
 *
 * This is the single biggest lever on citation precision: fusion is good at
 * recall but indifferent about which of 50 plausible passages actually answers
 * the question. If reranking is unavailable, the caller falls back to fusion
 * order rather than failing the request — a slightly worse answer beats none.
 */
export async function rerank(
  queryText: string,
  documents: string[],
  topK: number,
): Promise<RerankResult[]> {
  if (OFFLINE || documents.length === 0) {
    return documents.slice(0, topK).map((_, i) => ({ index: i, score: 0 }));
  }

  const resp = await callVoyage(RERANK_PATH, {
    query: queryText,
    documents,
    model: RERANK_MODEL,
    top_k: Math.min(topK, documents.length),
  });
  const json = (await resp.json()) as {
    data: { index: number; relevance_score: number }[];
  };

  return json.data
    .map((d) => ({ index: d.index, score: d.relevance_score }))
    .sort((a, b) => b.score - a.score);
}
