/**
 * (Re-)embed the phrasings in `answer_questions`.
 *
 * Runtime matching compares a user's question against these vectors, so they
 * must come from the same model as everything else. Run this after adding
 * answers, and after any change of embedding model — a stale phrasing vector
 * does not error, it just quietly stops matching.
 *
 * Embedding is free and local, so the default is to re-embed everything rather
 * than guess at what is stale. `--missing` limits it to rows that have never
 * been embedded (all-zero vectors, as the dev fixture writes).
 *
 *   npx tsx scripts/embedAnswerQuestions.ts [--missing]
 */

import { query, toVectorLiteral } from "../lib/db";
import { embedQuery } from "../lib/rag/embed";
import { normalizeQuery } from "../lib/rag/normalizeAr";
import { OFFLINE } from "../lib/rag/embed";

const BATCH = 32;

async function main() {
  if (OFFLINE) {
    console.error("DEEN_OFFLINE=1 produces no usable vectors — refusing.");
    process.exit(1);
  }

  const missingOnly = process.argv.includes("--missing");

  // An all-zero vector is what the fixture writes when no model was available.
  // It is never a legitimate embedding, so it is a safe "not done yet" marker.
  const rows = await query<{ id: string; text: string }>(
    `select aq.id, aq.text
       from answer_questions aq
      ${missingOnly ? "where aq.embedding = array_fill(0::real, array[1024])::vector" : ""}
      order by aq.id`,
  );

  if (rows.length === 0) {
    console.log("nothing to embed");
    return;
  }
  console.log(`embedding ${rows.length} phrasing(s)…`);

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    // Normalised to match how the corpus was embedded. See retrieve.ts.
    const vectors = await Promise.all(
      batch.map((r) => embedQuery(normalizeQuery(r.text))),
    );

    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j];
      if (!vec) throw new Error(`no vector returned for id=${batch[j].id}`);
      await query(`update answer_questions set embedding = $2::vector where id = $1`, [
        batch[j].id,
        toVectorLiteral(vec),
      ]);
      done++;
    }
    console.log(`  ${done}/${rows.length}`);
  }

  console.log(`done — ${done} phrasing(s) embedded`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
