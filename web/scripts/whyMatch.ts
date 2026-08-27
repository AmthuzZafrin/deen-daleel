/**
 * Explain a match. Why did *this* query get *that* answer?
 *
 *   npx tsx scripts/whyMatch.ts "what does islam say about ivf"
 *   npx tsx scripts/whyMatch.ts --expect ivf-and-fertility-treatment "..."
 *
 * `matchAnswer` reports one slug and one number. When the slug is wrong that
 * number says nothing about where it went wrong — whether the right answer
 * never reached the reranker, or reached it and lost. This prints every rung:
 * both retrieval arms, the fusion, which candidates survived, and the score of
 * every phrasing of every one of them.
 *
 * It calls `rankAnswers` rather than reproducing it. An earlier version of this
 * script kept its own copy of the pipeline, missed a change to the candidate
 * rule, and reported that an answer "never reached the reranker" when it had —
 * a diagnostic wrong in the confident direction, which is worse than no
 * diagnostic. `--expect` says where a given slug actually placed, and "(never
 * reranked)" from here can now be believed.
 */

import "dotenv/config";

import { pool, query } from "../lib/db";
import {
  rankAnswers,
  MATCH_THRESHOLD,
  MAX_MATCH_DISTANCE,
} from "../lib/rag/answers";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const expect = arg("expect");
  const userQuery = process.argv
    .slice(2)
    .filter((a, i, xs) => !a.startsWith("--") && xs[i - 1] !== "--expect")
    .join(" ")
    .trim();
  if (!userQuery) throw new Error('usage: whyMatch.ts [--expect slug] "question"');

  console.log(`query: ${userQuery}`);
  const r = await rankAnswers(userQuery);
  if (!r) {
    console.log("nothing retrieved at all — both arms came back empty");
    await pool.end();
    return;
  }

  // Slugs for the arms, which carry ids only.
  const slugRows = await query<{ id: string; slug: string }>(
    `select id, slug from answers where id = any($1)`,
    [[...new Set([...r.vec, ...r.lex].map((x) => x.answerId))]],
  );
  const slugOf = new Map(slugRows.map((x) => [Number(x.id), x.slug]));
  const name = (id: number) => slugOf.get(id) ?? r.answers.find((a) => a.answerId === id)?.slug ?? `#${id}`;

  const candidates = new Set(r.candidateIds);

  console.log("\nvector arm (top 10 of 25):");
  for (const x of r.vec.slice(0, 10)) console.log(`  ${String(x.rank).padStart(2)}. ${name(x.answerId)}`);

  console.log("\nlexical arm (top 10 of 25):");
  for (const x of r.lex.slice(0, 10)) console.log(`  ${String(x.rank).padStart(2)}. ${name(x.answerId)}`);

  console.log("\nfused (RRF), * = reached the reranker:");
  r.fused.slice(0, 15).forEach((f, i) => {
    console.log(
      `  ${candidates.has(f.answerId) ? "*" : " "} ${String(i + 1).padStart(2)}. ${name(f.answerId).padEnd(42)} rrf=${f.rrf.toFixed(5)}`,
    );
  });
  const floored = r.candidateIds.filter((id) => !r.fused.slice(0, 15).some((f) => f.answerId === id));
  if (floored.length) {
    console.log(`  (also in, on the vector floor: ${floored.map(name).join(", ")})`);
  }

  console.log("\nrerank, every phrasing of every candidate:");
  for (const p of r.perPhrasing) {
    console.log(`  ${p.score.toFixed(4)}  ${p.slug.padEnd(42)} "${p.phrasing}"`);
  }

  console.log("\nby answer, best phrasing only:");
  r.answers.slice(0, 8).forEach((a, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${a.score.toFixed(4)}  ${a.slug}`);
  });

  const top = r.answers[0];
  const runnerUp = r.answers[1];
  const tooFar = r.topDistance !== null && r.topDistance > MAX_MATCH_DISTANCE;
  console.log(
    `\ndistance to the nearest phrasing in the bank: ${r.topDistance?.toFixed(4) ?? "n/a"}` +
      ` (gate ${MAX_MATCH_DISTANCE}${tooFar ? " — TOO FAR, nothing is served" : ""})`,
  );
  console.log(
    `served: ${!tooFar && top.score >= MATCH_THRESHOLD ? top.slug : "(miss)"}  score=${top.score.toFixed(4)}  threshold=${MATCH_THRESHOLD}`,
  );
  if (runnerUp) {
    console.log(`margin over ${runnerUp.slug}: ${(top.score - runnerUp.score).toFixed(4)}`);
  }

  if (expect) {
    const rows = await query<{ id: string; status: string }>(
      `select id, status from answers where slug = $1`,
      [expect],
    );
    if (rows.length === 0) {
      console.log(`expected: ${expect} — no such answer`);
    } else {
      const id = Number(rows[0].id);
      const mine = r.answers.find((a) => a.answerId === id);
      console.log(
        `expected: ${expect} (${rows[0].status})` +
          `  vec=${r.vec.find((x) => x.answerId === id)?.rank ?? "-"}` +
          `  lex=${r.lex.find((x) => x.answerId === id)?.rank ?? "-"}` +
          `  fused=${(r.fused.findIndex((f) => f.answerId === id) + 1) || "-"}` +
          `  reranked=${mine ? mine.score.toFixed(4) : "(never reranked)"}`,
      );
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
