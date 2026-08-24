/**
 * Reconnect published citations to the chunks that now hold their text.
 *
 *     npx tsx scripts/rebindCitations.ts          # report and repair
 *     npx tsx scripts/rebindCitations.ts --check  # report only, non-zero if broken
 *
 * Run this after every ingest. `replace_chunks` deletes a document's chunks and
 * inserts new ones with new ids, so a citation's `chunk_id` goes stale — or
 * null — whenever a source is re-ingested. What the reviewer approved was a
 * passage at a printed location, and that survives; this finds it again.
 *
 * Matching is on `canonical_ref` and then on the quoted text appearing in the
 * chunk. The ref alone is not enough: a page can be split across several chunks,
 * and the citation belongs to the one that actually contains the words. Where
 * exactly one chunk qualifies, the binding is restored silently. Where none or
 * several do, the citation is left unresolved and reported, because guessing
 * which passage a scholar's ruling rests on is not a decision a script should
 * make.
 */

import "dotenv/config";

import { pool, query } from "../lib/db";

interface Broken {
  id: number;
  answer_id: number;
  slug: string;
  status: string;
  canonical_ref: string;
  cited_text: string;
}

async function main() {
  const checkOnly = process.argv.includes("--check");

  // Backfill refs for citations written before the ref was recorded. Their
  // chunk may still exist, in which case its location is recoverable now and
  // will not be after the next ingest.
  if (!checkOnly) {
    const backfilled = await query(
      `update answer_citations ac
          set canonical_ref = coalesce(nullif(c.canonical_ref, ''), d.canonical_ref)
         from chunks c join documents d on d.id = c.document_id
        where c.id = ac.chunk_id and ac.canonical_ref = ''
        returning ac.id`,
    );
    if (backfilled.length > 0) {
      console.log(`recorded a reference for ${backfilled.length} older citation(s)`);
    }
  }

  const broken = await query<Broken>(
    `select ac.id, ac.answer_id, a.slug, a.status, ac.canonical_ref, ac.cited_text
       from answer_citations ac
       join answers a on a.id = ac.answer_id
      where ac.chunk_id is null
      order by a.status, a.slug, ac.ordinal`,
  );

  if (broken.length === 0) {
    console.log("every citation resolves to a chunk.");
    await pool.end();
    return;
  }

  console.log(`${broken.length} citation(s) not bound to a chunk\n`);

  let repaired = 0;
  const unresolved: Broken[] = [];

  for (const row of broken) {
    if (!row.canonical_ref) {
      unresolved.push(row);
      continue;
    }

    // The quoted text is the tiebreaker within a reference: a page can span
    // several chunks, and the citation belongs to whichever holds the words.
    //
    // Compare on words alone — lowercased, punctuation removed, whitespace
    // collapsed. Punctuation is exactly where a citation and its source drift
    // apart without either being wrong: the fixture quoting Qur'an 2:183 ends
    // 'ward off (evil).' where Pickthall's text ends 'ward off (evil),', and an
    // exact match rejects that. `[:alnum:]` keeps Arabic as well as Latin, so
    // the same rule serves an Arabic fiqh passage.
    const candidates = await query<{ id: string }>(
      `select c.id
         from chunks c
         left join documents d on d.id = c.document_id
        where coalesce(nullif(c.canonical_ref, ''), d.canonical_ref) = $1
          and regexp_replace(
                regexp_replace(lower(c.content), '[^[:alnum:][:space:]]', '', 'g'),
                '\\s+', ' ', 'g')
              like '%' || regexp_replace(
                regexp_replace(lower($2), '[^[:alnum:][:space:]]', '', 'g'),
                '\\s+', ' ', 'g') || '%'`,
      [row.canonical_ref, row.cited_text],
    );

    if (candidates.length === 1 && !checkOnly) {
      await query(`update answer_citations set chunk_id = $1 where id = $2`, [
        Number(candidates[0]!.id),
        row.id,
      ]);
      repaired++;
    } else if (candidates.length !== 1) {
      unresolved.push(row);
    }
  }

  if (repaired > 0) console.log(`rebound ${repaired} citation(s)\n`);

  if (unresolved.length > 0) {
    // Published answers first: those are on display to readers right now,
    // making a claim with nothing behind it.
    console.log(`${unresolved.length} still unresolved — review these:\n`);
    for (const row of unresolved) {
      const flag = row.status === "published" ? "PUBLISHED" : row.status;
      console.log(`  [${flag}] ${row.slug}`);
      console.log(`    ref:   ${row.canonical_ref || "(none recorded)"}`);
      console.log(`    quote: ${row.cited_text.slice(0, 80)}`);
    }
    const live = unresolved.filter((r) => r.status === "published").length;
    if (live > 0) {
      console.log(
        `\n${live} of these are on published answers. A published answer citing ` +
          `nothing is worse than no answer — unpublish or re-cite them.`,
      );
    }
  }

  await pool.end();
  if (checkOnly && broken.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
