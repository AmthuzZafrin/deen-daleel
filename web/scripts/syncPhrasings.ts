/**
 * Push `content/questions.yaml` phrasings into `answer_questions`, and nothing
 * else.
 *
 *   npx tsx scripts/syncPhrasings.ts --all
 *   npx tsx scripts/syncPhrasings.ts --slug leaving-islam --slug how-much-is-nisab
 *   npx tsx scripts/syncPhrasings.ts --all --dry-run
 *
 * `draft.ts commit` also writes phrasings, but it rewrites the answer with them
 * and sets `status = 'draft'` on the way past — which for a published bank means
 * adding one paraphrase silently unpublishes the answer. Since a paraphrase
 * changes nothing a reader reads, it should not cost a republication, and it
 * must not be able to take an answer off the site by accident.
 *
 * So this touches `answer_questions` only. Body, citations, status, reviewer and
 * published_at are left exactly as they are.
 *
 * Phrasings are embedded through `normalizeQuery`, the same function the runtime
 * puts a reader's question through before comparing. `draft.ts` does not, which
 * means a phrasing it wrote sits in a slightly different place in the space from
 * where the same words typed by a reader would land. Harmless for English, not
 * harmless in principle, and the reason to prefer this path.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { pool, query, toVectorLiteral } from "../lib/db";
import { embedQuery, OFFLINE } from "../lib/rag/embed";
import { normalizeQuery } from "../lib/rag/normalizeAr";

interface Spec {
  slug: string;
  question: string;
  paraphrases?: string[];
}

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const has = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  if (OFFLINE) {
    console.error("DEEN_OFFLINE=1 produces no usable vectors — refusing.");
    process.exit(1);
  }

  const all = has("all");
  const slugs = args("slug");
  const dryRun = has("dry-run");
  if (!all && slugs.length === 0) {
    throw new Error("pass --all, or one or more --slug <name>");
  }

  const yamlPath = path.join(process.cwd(), "..", "content", "questions.yaml");
  const specs = (parse(readFileSync(yamlPath, "utf8")) as Spec[]).filter(
    (s) => all || slugs.includes(s.slug),
  );

  const missing = slugs.filter((s) => !specs.some((x) => x.slug === s));
  if (missing.length) throw new Error(`not in questions.yaml: ${missing.join(", ")}`);

  let changed = 0;
  let untouched = 0;

  for (const spec of specs) {
    const rows = await query<{ id: string }>(`select id from answers where slug = $1`, [spec.slug]);
    if (rows.length === 0) {
      console.log(`${spec.slug}: no stored answer — skipped`);
      continue;
    }
    const answerId = Number(rows[0].id);

    const wanted = [spec.question, ...(spec.paraphrases ?? [])];
    const existing = await query<{ text: string }>(
      `select text from answer_questions where answer_id = $1`,
      [answerId],
    );
    const have = new Set(existing.map((r) => r.text));
    const same = wanted.length === have.size && wanted.every((w) => have.has(w));
    if (same) {
      untouched++;
      continue;
    }

    const added = wanted.filter((w) => !have.has(w));
    const removed = [...have].filter((h) => !wanted.includes(h));
    console.log(
      `${spec.slug}: ${wanted.length} phrasings` +
        (added.length ? `\n  + ${added.join("\n  + ")}` : "") +
        (removed.length ? `\n  - ${removed.join("\n  - ")}` : ""),
    );
    changed++;
    if (dryRun) continue;

    const embeddings = await Promise.all(wanted.map((p) => embedQuery(normalizeQuery(p))));
    if (embeddings.some((e) => !e)) {
      throw new Error(`${spec.slug}: embedding service returned nothing — refusing to write`);
    }

    // Replaced wholesale inside one transaction: a partial rewrite would leave
    // an answer reachable by some of its phrasings and not others, which is
    // exactly the failure that is hardest to notice from the outside.
    await query("begin");
    try {
      await query(`delete from answer_questions where answer_id = $1`, [answerId]);
      for (const [i, text] of wanted.entries()) {
        await query(
          `insert into answer_questions (answer_id, text, is_primary, embedding)
           values ($1, $2, $3, $4::vector)`,
          [answerId, text, i === 0, toVectorLiteral(embeddings[i]!)],
        );
      }
      await query("commit");
    } catch (err) {
      await query("rollback");
      throw err;
    }
  }

  console.log(
    `\n${changed} answer${changed === 1 ? "" : "s"} ${dryRun ? "would change" : "updated"}, ${untouched} already matching.`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
