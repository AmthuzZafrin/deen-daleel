/**
 * Inspect retrieval from the command line, before any UI exists.
 *
 *   npx tsx scripts/retrieve.ts "combining prayers while travelling"
 *   DEEN_OFFLINE=1 npx tsx scripts/retrieve.ts "fasting in Ramadan"
 *
 * Retrieval quality is the ceiling on answer quality: if the right ayah is not
 * in this list, no amount of prompting will make the model cite it. Fix what
 * this prints before touching the system prompt.
 */

import "dotenv/config";

import { pool } from "../lib/db";
import { OFFLINE } from "../lib/rag/embed";
import { retrieve } from "../lib/rag/retrieve";

async function main() {
  const q = process.argv.slice(2).join(" ").trim();
  if (!q) {
    console.error('usage: tsx scripts/retrieve.ts "your question"');
    process.exit(1);
  }

  if (OFFLINE) {
    console.log(
      "\n  DEEN_OFFLINE=1 — lexical-only. The vector arm and reranker are\n" +
        "  disabled, so treat ranking as indicative, not representative.\n",
    );
  }

  console.log(`query: ${q}\n`);
  const started = Date.now();
  const chunks = await retrieve(q);
  const elapsed = Date.now() - started;

  if (chunks.length === 0) {
    console.log("no results — is the corpus ingested? (ingest/pipelines/quran.py)");
    await pool.end();
    return;
  }

  const byKind = chunks.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `${chunks.length} chunks in ${elapsed}ms  [${Object.entries(byKind)
      .map(([k, n]) => `${k}:${n}`)
      .join(" ")}]\n`,
  );

  for (const [i, c] of chunks.entries()) {
    const rerank =
      c.rerankScore !== undefined && !OFFLINE
        ? `  rerank=${c.rerankScore.toFixed(4)}`
        : "";
    console.log(
      `${String(i + 1).padStart(2)}. ${c.canonicalRef}   ` +
        `(${c.kind})  fusion=${c.fusionScore.toFixed(5)}${rerank}`,
    );
    const snippet = (c.englishText ?? c.content)
      .replace(/\s+/g, " ")
      .slice(0, 150);
    console.log(`    ${snippet}${snippet.length >= 150 ? "…" : ""}\n`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
