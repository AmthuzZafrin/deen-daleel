/**
 * Can anything tell "we have no answer for this" from "we do"?
 *
 * `MATCH_THRESHOLD` gates on the reranker's absolute score, and the eval set
 * says that score cannot carry the weight: across questions the bank *does*
 * answer, the correct answer ranked first with scores from 0.017 to 0.38, while
 * a question the bank has nothing for ("what does islam say about deepfakes")
 * reached 0.082. The ranges overlap, so no threshold on that number separates
 * them — every setting either drops correct answers or invents wrong ones.
 *
 * Cosine distance is a different kind of number: it is bounded, it means the
 * same thing for every query, and nothing about sentence form inflates it. This
 * prints both signals for every eval question, split by whether the bank has an
 * answer, so the two can be compared as gates rather than assumed.
 *
 *   npx tsx scripts/tuneGate.ts
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pool, query, toVectorLiteral } from "../lib/db";
import { rankAnswers } from "../lib/rag/answers";
import { embedQuery } from "../lib/rag/embed";
import { normalizeQuery } from "../lib/rag/normalizeAr";

async function main() {
  const cases = readFileSync(join(process.cwd(), "evals", "questions.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [q, e] = l.split("\t");
      return { question: q.trim(), expected: e.trim() === "-" ? [] : e.trim().split("|") };
    });

  const rows: { q: string; inBank: boolean; dist: number; rr: number; correct: boolean }[] = [];
  for (const c of cases) {
    const vector = await embedQuery(normalizeQuery(c.question));
    const [near] = await query<{ slug: string; distance: string }>(
      `select a.slug, aq.embedding <=> $1::vector as distance
         from answer_questions aq
         join answers a on a.id = aq.answer_id
        where a.status = 'published'
        order by aq.embedding <=> $1::vector
        limit 1`,
      [toVectorLiteral(vector!)],
    );
    const r = await rankAnswers(c.question);
    const top = r?.answers[0];
    rows.push({
      q: c.question,
      inBank: c.expected.length > 0,
      dist: Number(near.distance),
      rr: top?.score ?? 0,
      correct: top ? c.expected.includes(top.slug) : false,
    });
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  const out = rows.filter((r) => !r.inBank);
  const inb = rows.filter((r) => r.inBank);
  const q = (xs: number[], p: number) => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

  console.log("cosine distance to the nearest stored phrasing (lower = closer):");
  console.log(`  bank has an answer  (n=${inb.length})  min=${q(inb.map(r=>r.dist),0).toFixed(3)}  median=${q(inb.map(r=>r.dist),0.5).toFixed(3)}  p90=${q(inb.map(r=>r.dist),0.9).toFixed(3)}  max=${q(inb.map(r=>r.dist),1).toFixed(3)}`);
  console.log(`  bank has nothing    (n=${out.length})  min=${q(out.map(r=>r.dist),0).toFixed(3)}  median=${q(out.map(r=>r.dist),0.5).toFixed(3)}  max=${q(out.map(r=>r.dist),1).toFixed(3)}`);

  console.log("\nreranker top score:");
  console.log(`  bank has an answer            min=${q(inb.map(r=>r.rr),0).toFixed(3)}  median=${q(inb.map(r=>r.rr),0.5).toFixed(3)}  max=${q(inb.map(r=>r.rr),1).toFixed(3)}`);
  console.log(`  bank has nothing              min=${q(out.map(r=>r.rr),0).toFixed(3)}  median=${q(out.map(r=>r.rr),0.5).toFixed(3)}  max=${q(out.map(r=>r.rr),1).toFixed(3)}`);

  console.log("\nthe out-of-bank questions in full:");
  for (const r of out) console.log(`  dist=${r.dist.toFixed(3)}  rerank=${r.rr.toFixed(4)}  "${r.q}"`);

  console.log("\nin-bank questions whose distance is worst — the ones a distance gate would drop:");
  for (const r of [...inb].sort((a, b) => b.dist - a.dist).slice(0, 10)) {
    console.log(`  dist=${r.dist.toFixed(3)}  rerank=${r.rr.toFixed(4)}  ${r.correct ? "top is correct" : "top is wrong  "}  "${r.q}"`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
