/**
 * Measure what the Arabic glossary layer actually did.
 *
 *   npx tsx scripts/measureGloss.ts > out.tsv
 *
 * The layer was added on a hypothesis: that practical questions were landing on
 * the one ayah that mentions their topic and never on the fiqh chapter that
 * answers it — ten separate wudu questions all returning Qur'an 5:6, which
 * commands washing but says nothing about whether nail varnish is a barrier.
 * Adding chapter vocabulary in Arabic was the fix. This checks whether it was.
 *
 * Each question is retrieved twice against the same corpus, once with the layer
 * off and once with it on. That comparison is sound even though the absolute
 * rerank number is not: an English question scored against Arabic prose always
 * scores low, but the *same* question scored twice differs only by the layer.
 *
 * Only the questions the layer touches are run. The rest gloss identically
 * either way and would produce 366 rows of noise.
 */

import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { pool } from "../lib/db";
import { glossQuery } from "../lib/rag/glossary";
import { retrieve } from "../lib/rag/retrieve";

interface Spec {
  slug: string;
  question: string;
  tier?: string;
  expect?: string;
}

const QUESTIONS = path.resolve(process.cwd(), "..", "content", "questions.yaml");

// GLOSS and CONCEPT hold no Arabic script, so an Arabic character in the
// glossed output means, and only means, that the PRACTICE layer fired.
const ARABIC = /[؀-ۿ]/;

async function best(question: string, gloss: "full" | "english-only") {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const chunks = await retrieve(question, { topK: 12, gloss });
      if (chunks.length === 0) return null;
      const top = chunks.reduce((a, b) =>
        (b.rerankScore ?? 0) > (a.rerankScore ?? 0) ? b : a,
      );
      return {
        score: top.rerankScore ?? 0,
        kind: top.kind,
        ref: top.canonicalRef,
      };
    } catch (err) {
      if (attempt === 1) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function main() {
  const specs = parse(readFileSync(QUESTIONS, "utf-8")) as Spec[];
  const touched = specs.filter((s) => ARABIC.test(glossQuery(s.question)));

  console.error(`${touched.length} of ${specs.length} questions touched`);
  console.log(
    "slug\ttier\tbeforeScore\tafterScore\tratio\tbeforeKind\tafterKind\tbeforeRef\tafterRef\tverdict",
  );

  for (const [i, spec] of touched.entries()) {
    const before = await best(spec.question, "english-only");
    const after = await best(spec.question, "full");
    if (!before || !after) {
      console.log(`${spec.slug}\t\tEMPTY`);
      continue;
    }

    const tier = spec.expect === "decline" ? "C" : (spec.tier ?? "A");
    const ratio = before.score > 0 ? after.score / before.score : Infinity;

    // What the layer was built to change: a question that used to top out on
    // scripture or tafsir now topping out on a fiqh or hadith work.
    const wasScripture = before.kind === "quran" || before.kind === "tafsir";
    const isScripture = after.kind === "quran" || after.kind === "tafsir";
    const verdict =
      wasScripture && !isScripture
        ? "MOVED"
        : !wasScripture && isScripture
          ? "REGRESSED"
          : before.ref !== after.ref
            ? "shifted"
            : "same";

    console.log(
      [
        spec.slug,
        tier,
        before.score.toFixed(4),
        after.score.toFixed(4),
        Number.isFinite(ratio) ? ratio.toFixed(2) : "inf",
        before.kind,
        after.kind,
        before.ref,
        after.ref,
        verdict,
      ].join("\t"),
    );
    if ((i + 1) % 10 === 0) console.error(`  ${i + 1}/${touched.length}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
