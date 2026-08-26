/**
 * Publish reviewed answers in bulk.
 *
 *   npx tsx scripts/publish.ts --reviewer "Name" --section 1
 *   npx tsx scripts/publish.ts --reviewer "Name" --slug how-do-i-become-muslim
 *   npx tsx scripts/publish.ts --unreviewed --all
 *   npx tsx scripts/publish.ts --unpublish --all
 *
 * `/review` publishes one answer at a time, which is right when a person is
 * reading them one at a time. This is for the other case: a tranche that has
 * already been read and approved as a group.
 *
 * It enforces the same two guards the route does, because the guards are the
 * point and a second door into the same table must not be a weaker one:
 *
 *   - provenance must be stated, and it must be true: either `--reviewer
 *     "Name"`, which readers see, or `--unreviewed`, which puts a notice on
 *     every answer saying no scholar has read it. There is no unlabelled path;
 *     silence would read as approval.
 *   - an answer whose question phrasings are not embedded is refused, because
 *     it would match by keyword only and nothing would say so.
 *   - an answer with no citations is refused. Daleel is the whole product.
 *
 * It does *not* substitute for reading. `--unreviewed --all` puts 469 answers
 * in front of readers that nobody has checked; the notice makes that honest,
 * not harmless.
 */

import "dotenv/config";

import { pool, query, toVectorLiteral } from "../lib/db";
import { EMBEDDING_DIM } from "../lib/env";
import { sectionsBySlug } from "../lib/sections";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const unpublish = has("unpublish");
  const reviewer = arg("reviewer")?.trim();
  const section = arg("section");
  const slug = arg("slug");
  const all = has("all");
  const dryRun = has("dry-run");

  // Two honest ways to publish, and no third. Either a named person approved
  // the answer and readers are told who, or nobody did and readers are told
  // that instead. `--unreviewed` has to be typed out because publishing 469
  // rulings that nobody has read is a decision, not a default.
  const unreviewed = has("unreviewed");
  if (!unpublish && !reviewer && !unreviewed) {
    throw new Error(
      "publishing needs one of:\n" +
        '  --reviewer "Your Name"  a person approved these; readers are shown the name\n' +
        "  --unreviewed            nobody has; readers are shown a notice saying so",
    );
  }
  if (reviewer && unreviewed) {
    throw new Error("--reviewer and --unreviewed contradict each other");
  }
  if (!all && !section && !slug) {
    throw new Error("choose a scope: --all, --section N, or --slug <slug>");
  }

  // Resolve the target set.
  let targets: { id: string; slug: string; status: string }[];
  if (slug) {
    targets = await query(`select id, slug, status from answers where slug = $1`, [slug]);
    if (targets.length === 0) throw new Error(`no answer with slug ${slug}`);
  } else {
    targets = await query(
      `select id, slug, status from answers
        where status ${unpublish ? "= 'published'" : "<> 'published'"}
        order by id`,
    );
    if (section) {
      const sections = sectionsBySlug();
      const want = Number(section);
      targets = targets.filter((t) => sections.get(t.slug)?.index === want);
      if (targets.length === 0) throw new Error(`no unpublished answers in section ${section}`);
    }
  }

  if (unpublish) {
    if (dryRun) {
      console.log(`would revert ${targets.length} answers to draft`);
      await pool.end();
      return;
    }
    const done = await query<{ id: string }>(
      `update answers
          set status = 'draft', reviewed_by = null, reviewed_at = null,
              published_at = null, updated_at = now()
        where id = any($1) returning id`,
      [targets.map((t) => Number(t.id))],
    );
    console.log(`reverted ${done.length} answers to draft`);
    await pool.end();
    return;
  }

  // Guard: refuse anything whose phrasings are not embedded. Checked for the
  // whole batch in one query rather than per answer — at 469 the round trips
  // are the slow part, and a partial publish is worse than none.
  const zero = toVectorLiteral(new Array(EMBEDDING_DIM).fill(0));
  const unembedded = await query<{ slug: string; n: string }>(
    `select a.slug, count(*) as n
       from answers a join answer_questions q on q.answer_id = a.id
      where a.id = any($1)
        and (q.embedding is null or q.embedding = $2::vector)
      group by a.slug`,
    [targets.map((t) => Number(t.id)), zero],
  );
  if (unembedded.length > 0) {
    console.error(
      `refusing: ${unembedded.length} answer(s) have unembedded phrasings and ` +
        `would match by keyword only:`,
    );
    for (const u of unembedded.slice(0, 10)) console.error(`  ${u.slug} (${u.n})`);
    console.error(`fix with: npx tsx scripts/embedAnswerQuestions.ts --missing`);
    process.exit(1);
  }

  // Guard: an answer with no daleel is not publishable, whatever route it took.
  const bare = await query<{ slug: string }>(
    `select a.slug from answers a
      where a.id = any($1)
        and not exists (select 1 from answer_citations c where c.answer_id = a.id)`,
    [targets.map((t) => Number(t.id))],
  );
  if (bare.length > 0) {
    console.error(`refusing: ${bare.length} answer(s) have no citations:`);
    for (const b of bare.slice(0, 10)) console.error(`  ${b.slug}`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(
      unreviewed
        ? `would publish ${targets.length} answers with no reviewer, each carrying the unreviewed notice`
        : `would publish ${targets.length} answers as reviewed by "${reviewer}"`,
    );
    for (const t of targets.slice(0, 10)) console.log(`  ${t.slug}`);
    if (targets.length > 10) console.log(`  ... and ${targets.length - 10} more`);
    await pool.end();
    return;
  }

  // `reviewed_at` stays null alongside a null reviewer: a timestamp with no
  // name is the shape of a review that happened and lost its author, which is
  // not what this is.
  const done = await query<{ id: string }>(
    `update answers
        set status = 'published',
            reviewed_by = $2,
            reviewed_at = case when $2::text is null then null else now() end,
            published_at = now(), updated_at = now()
      where id = any($1) returning id`,
    [targets.map((t) => Number(t.id)), unreviewed ? null : reviewer],
  );
  console.log(
    unreviewed
      ? `published ${done.length} answers, unreviewed and labelled as such`
      : `published ${done.length} answers, reviewed by "${reviewer}"`,
  );

  const counts = await query<{ status: string; n: string }>(
    `select status, count(*)::text as n from answers group by status order by 1`,
  );
  for (const c of counts) console.log(`  ${c.status}: ${c.n}`);
  await pool.end();
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
