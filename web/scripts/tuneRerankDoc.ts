/**
 * What should the reranker actually be shown?
 *
 * `rankAnswers` reranks the query against each stored *phrasing* — a bare
 * question of six or eight words. bge-reranker-v2-m3 was trained to score a
 * query against a passage, and on two short questions it leans on sentence
 * form far more than on subject. Measured directly against the service:
 *
 *   "is vanilla extract haram"    vs "Is vanilla extract haram because of the
 *                                     alcohol?"                      -> 0.999
 *   "what about vanilla extract"  vs the same phrasing               -> 0.040
 *   "can i get a tattoo"          vs "can Muslims get tattoos"       -> 0.501
 *   "can i get a tattoo"          vs "Are piercings allowed?"        -> 0.849
 *
 * Same topic, wildly different scores; different topic, higher score. That is
 * form matching, and it is the single cause behind most of the eval set's
 * failures. This script tests whether giving the model more of a document —
 * the answer's own question, or the opening of its body — restores subject
 * weighting, by re-scoring the whole eval set under each form.
 *
 *   npx tsx scripts/tuneRerankDoc.ts
 *
 * Candidate generation does not depend on the form, so it runs once and every
 * form is scored against the same candidates. What changes is only what the
 * reranker is handed.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pool, query } from "../lib/db";
import { rankAnswers, MATCH_THRESHOLD } from "../lib/rag/answers";
import { rerank } from "../lib/rag/embed";

interface Ctx {
  slug: string;
  question: string;
  body: string;
}

const FORMS: Record<string, (c: Ctx, phrasing: string) => string> = {
  "phrasing only": (_c, p) => p,
  "primary + phrasing": (c, p) => `${c.question} ${p}`,
  "phrasing + body120": (c, p) => `${p} ${c.body.slice(0, 120)}`,
  "phrasing + body250": (c, p) => `${p} ${c.body.slice(0, 250)}`,
  "phrasing + body500": (c, p) => `${p} ${c.body.slice(0, 500)}`,
  "primary + phrasing + body250": (c, p) => `${c.question} ${p} ${c.body.slice(0, 250)}`,
};

async function main() {
  const cases = readFileSync(join(process.cwd(), "evals", "questions.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [q, e] = l.split("\t");
      return { question: q.trim(), expected: e.trim() === "-" ? [] : e.trim().split("|") };
    });

  const ctxRows = await query<{ slug: string; question: string; body: string }>(
    `select slug, question,
            regexp_replace(body, '[#*\\n]+', ' ', 'g') as body
       from answers where status = 'published'`,
  );
  const ctx = new Map(ctxRows.map((r) => [r.slug, r]));

  // Candidates once; every form is judged on the same shortlist.
  const shortlists: { expected: string[]; query: string; pairs: { slug: string; phrasing: string }[] }[] = [];
  for (const c of cases) {
    const r = await rankAnswers(c.question);
    shortlists.push({
      expected: c.expected,
      query: c.question,
      pairs: (r?.perPhrasing ?? []).map((p) => ({ slug: p.slug, phrasing: p.phrasing })),
    });
    process.stderr.write(".");
  }
  process.stderr.write("\n");

  const dump: unknown[] = [];
  console.log("form".padEnd(30) + "  direct  offered  miss  WRONG");
  for (const [name, build] of Object.entries(FORMS)) {
    let direct = 0, offered = 0, miss = 0;
    const wrong: string[] = [];
    for (const s of shortlists) {
      const docs = s.pairs.map((p) => {
        const c = ctx.get(p.slug);
        return c ? build(c, p.phrasing) : p.phrasing;
      });
      const scored = docs.length ? await rerank(s.query, docs, docs.length) : [];

      const best = new Map<string, number>();
      for (const r of scored) {
        const slug = s.pairs[r.index].slug;
        if (!best.has(slug) || r.score > best.get(slug)!) best.set(slug, r.score);
      }
      const ladder = [...best.entries()].map(([slug, score]) => ({ slug, score })).sort((a, b) => b.score - a.score);

      dump.push({ query: s.query, expected: s.expected, form: name, ladder });
      const top = ladder[0];
      if (!top || top.score < MATCH_THRESHOLD) {
        if (s.expected.length === 0) direct++;
        else miss++;
        continue;
      }
      const near = ladder.slice(1).filter((a) => top.score - a.score < 0.15).slice(0, 3);
      const shown = [top, ...near].map((x) => x.slug);
      if (s.expected.includes(top.slug)) near.length ? offered++ : direct++;
      else if (shown.some((x) => s.expected.includes(x))) offered++;
      else wrong.push(`${s.query} -> ${top.slug}`);
    }
    console.log(
      name.padEnd(30) + `  ${String(direct).padStart(6)}  ${String(offered).padStart(7)}  ${String(miss).padStart(4)}  ${String(wrong.length).padStart(5)}`,
    );
    if (process.argv.includes("--wrong")) for (const w of wrong) console.log(`      ${w}`);
  }

  const out = process.env.DUMP_LADDERS;
  if (out) {
    (await import("node:fs")).writeFileSync(out, JSON.stringify(dump));
    process.stderr.write(`wrote ladders to ${out}\n`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
