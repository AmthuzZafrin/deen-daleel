/**
 * Score the matcher against how people actually ask.
 *
 *   npx tsx scripts/probe.ts
 *   npx tsx scripts/probe.ts --verbose        every row, not just the failures
 *
 * Reads `evals/questions.tsv`: a real-world phrasing, then the slug (or slugs,
 * `|`-separated) that would genuinely serve the reader, or `-` where the bank
 * has nothing and an honest miss is the right answer.
 *
 * Five outcomes, and they are not equally bad:
 *
 *   direct   the reader got the answer they asked for, and only that
 *   offered  they got a near-tie, with the right question among the ones the
 *            page offers them — one click, and they can see the ambiguity
 *   miss     they got source passages and an honest "we haven't written this"
 *   WRONG    they got a confident answer to a different question
 *   BURIED   they got a wrong answer and the offered alternatives did not
 *            include the right one either
 *
 * A miss costs a reader a little time. A wrong match costs them their trust,
 * and in this domain it may cost them more than that — a confident ruling on
 * abortion served to someone asking about IVF is not a near-miss, it is a
 * different ruling. Never average these into one accuracy number, which would
 * let wrong matches hide behind hits.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { pool } from "../lib/db";
import { matchAnswer } from "../lib/rag/answers";

interface Case {
  question: string;
  expected: string[];
}

function load(): Case[] {
  // `questions.tsv` chose every threshold, margin and document form in the
  // matcher, and phrasings were added to fix what it caught — so it now scores
  // its own tuning. `--set heldout` is the number to quote.
  const i = process.argv.indexOf("--set");
  const name = i === -1 ? "questions" : process.argv[i + 1];
  const path = join(process.cwd(), "evals", `${name}.tsv`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [question, expected] = l.split("\t");
      return {
        question: question.trim(),
        expected: expected.trim() === "-" ? [] : expected.trim().split("|"),
      };
    });
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const cases = load();

  let direct = 0;
  let offered = 0;
  let miss = 0;
  const wrong: { q: string; got: string; score: number; want: string[]; alts: string[] }[] = [];
  const buried: typeof wrong = [];
  const missed: { q: string; want: string[]; score: number | null }[] = [];

  for (const c of cases) {
    const r = await matchAnswer(c.question);
    const got = r.answer?.slug ?? null;
    const score = r.answer?.score ?? r.topScore;
    const alts = r.alternatives.map((a) => a.slug);

    let verdict: "direct" | "offered" | "miss" | "WRONG" | "BURIED";
    if (got === null) {
      // No answer served. Right when the bank has nothing, a miss otherwise.
      verdict = c.expected.length === 0 ? "direct" : "miss";
    } else if (c.expected.includes(got)) {
      verdict = alts.length === 0 ? "direct" : "offered";
    } else if (alts.some((a) => c.expected.includes(a))) {
      verdict = "offered";
    } else {
      verdict = alts.length > 0 ? "BURIED" : "WRONG";
    }

    if (verdict === "direct") direct++;
    else if (verdict === "offered") offered++;
    else if (verdict === "miss") {
      miss++;
      missed.push({ q: c.question, want: c.expected, score });
    } else {
      const row = { q: c.question, got: got!, score: score ?? 0, want: c.expected, alts };
      if (verdict === "BURIED") buried.push(row);
      else wrong.push(row);
    }

    if (verbose || (verdict !== "direct" && verdict !== "offered")) {
      console.log(
        `${verdict.padEnd(7)} ${(score ?? 0).toFixed(3)}  ${c.question}\n` +
          `           got=${got ?? "(none)"}  want=${c.expected.join("|") || "(none)"}` +
          (alts.length ? `  also offered: ${alts.join(", ")}` : ""),
      );
    }
  }

  const n = cases.length;
  const bad = wrong.length + buried.length;
  console.log(
    `\n${n} questions:  ${direct} direct  ${offered} offered  ${miss} miss  ` +
      `${wrong.length} WRONG  ${buried.length} BURIED\n` +
      `${direct + offered} of ${n} (${(((direct + offered) / n) * 100).toFixed(0)}%) put the right answer in front of the reader; ` +
      `${bad} (${((bad / n) * 100).toFixed(0)}%) did not.`,
  );

  if (bad) {
    console.log("\nthe reader never sees the right answer here:");
    for (const w of [...wrong, ...buried]) {
      console.log(
        `  ${w.score.toFixed(3)}  "${w.q}"\n           served ${w.got}, wanted ${w.want.join("|")}` +
          (w.alts.length ? `\n           offered ${w.alts.join(", ")}` : ""),
      );
    }
  }
  if (missed.length) {
    console.log("\nhonest misses — an answer exists but nothing was served:");
    for (const m of missed) {
      console.log(`  ${(m.score ?? 0).toFixed(3)}  "${m.q}"  wanted ${m.want.join("|")}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
