/**
 * Environment access.
 *
 * Reads are lazy and validated at the point of use rather than at import time,
 * so a missing VOYAGE_API_KEY fails the request that actually needed it with a
 * clear message, instead of crashing the whole server at boot.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get databaseUrl(): string {
    return (
      process.env.DATABASE_URL ??
      "postgresql://deen:deen@localhost:5433/deen_daleel"
    );
  },
  get anthropicApiKey(): string {
    return required("ANTHROPIC_API_KEY");
  },
  get voyageApiKey(): string {
    return required("VOYAGE_API_KEY");
  },
  /**
   * Signs the session cookie, which is the only thing scoping a reader's
   * conversations to them.
   *
   * The development fallback must not survive into production: unset there, a
   * deployed instance would sign cookies with a value published in this file,
   * and anyone could forge one and read another reader's history. Unlike
   * `REVIEW_TOKEN`, which fails closed, this one used to fail silently open —
   * so it is now required, matching how the review gate already behaves.
   */
  get sessionSecret(): string {
    if (process.env.NODE_ENV === "production") return required("SESSION_SECRET");
    return process.env.SESSION_SECRET ?? "dev-only-insecure-secret";
  },
  /**
   * Voyage API root. Override to route through a gateway or proxy, or to point
   * at a local stub when exercising the retrieval path without a real key.
   */
  get voyageBaseUrl(): string {
    return (
      process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com/v1"
    ).replace(/\/+$/, "");
  },
};

/**
 * Embedding config, kept in lockstep with ingest/config.py and the schema.
 *
 * A query must be embedded by the same model that embedded the corpus —
 * vectors from two different models are not comparable, and the resulting
 * search returns plausible-looking nonsense rather than an error. If this
 * changes, re-run ingestion.
 *
 * **The default is now the local BGE-M3 service**, not Voyage. Start it with
 * `cd ingest && .venv/bin/python -m serve_embeddings` and point
 * `VOYAGE_BASE_URL` at it — it speaks the same wire format, so nothing in this
 * client changes:
 *
 *     VOYAGE_BASE_URL=http://127.0.0.1:8001/v1 VOYAGE_API_KEY=local npm run dev
 *
 * Both models emit 1024 dimensions, matching `vector(1024)` in the schema, so
 * switching between them needs no migration — only a re-embed of the corpus.
 */
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "BAAI/bge-m3";
export const EMBEDDING_DIM = 1024;
export const RERANK_MODEL =
  process.env.RERANK_MODEL ?? "BAAI/bge-reranker-v2-m3";
