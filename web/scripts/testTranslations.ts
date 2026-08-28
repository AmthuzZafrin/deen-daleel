/**
 * Re-check every attached translation against the passage it is attached to.
 *
 * The claim the source panel makes is narrow and specific: this English is a
 * published translation of Arabic that is *on this page*. The pipeline enforces
 * that when it writes the rows; this enforces it against the database, which is
 * what the app actually reads, and is the check that would catch a re-ingest
 * moving chunk text out from under a translation that stayed behind.
 *
 * A failure here is not cosmetic. A row that survives with the wrong chunk puts
 * a hadith the reader is not looking at underneath the Arabic they are, which is
 * the same class of error as a mistranslation and harder to notice.
 *
 *     npx tsx scripts/testTranslations.ts
 */
import "dotenv/config";
import { pool, query } from "../lib/db";
import { normalizeArabic } from "../lib/rag/normalizeAr";

/** The same reduction the matcher used: normalised, punctuation dropped. */
function words(text: string): string {
  return normalizeArabic(text).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
}

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) return;
  failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  const total = await query<{ n: string }>(
    `select count(*) as n from chunk_translations`,
  );
  const n = Number(total[0]!.n);
  console.log(`translations: ${n}`);
  if (n === 0) {
    console.log("nothing to check — run ingest/pipelines/hadith_english.py");
    return;
  }

  const stats = await query<{ collection: string; n: string; partial: string }>(
    `select collection, count(*) as n,
            count(*) filter (where coverage < 0.95) as partial
       from chunk_translations group by collection order by count(*) desc`,
  );
  for (const s of stats) {
    console.log(
      `  ${s.collection.padEnd(20)} ${String(s.n).padStart(6)}  ` +
        `(${s.partial} partial)`,
    );
  }

  // --- the invariant ------------------------------------------------------
  //
  // Streamed in batches: the join is over every attached translation and the
  // full text of its chunk, which does not want to be one result set.
  let checked = 0;
  let missing = 0;
  const BATCH = 2000;
  for (let offset = 0; offset < n; offset += BATCH) {
    const rows = await query<{
      id: string;
      collection: string;
      hadith_number: number;
      matched_arabic: string;
      coverage: number;
      english_text: string;
      text_ar_norm: string;
    }>(
      `select t.id, t.collection, t.hadith_number, t.matched_arabic, t.coverage,
              t.english_text, c.text_ar_norm
         from chunk_translations t join chunks c on c.id = t.chunk_id
        order by t.id limit $1 offset $2`,
      [BATCH, offset],
    );
    for (const r of rows) {
      checked++;
      const where = `${r.collection} ${r.hadith_number} (row ${r.id})`;

      const run = words(r.matched_arabic);
      check(`matched run is empty`, run.length > 0, where);

      // The whole point: the Arabic that was translated is in the passage.
      if (run && !words(r.text_ar_norm).includes(run)) {
        missing++;
        check(`matched Arabic is not in the chunk`, false, where);
      }

      check(
        `coverage out of range`,
        r.coverage > 0 && r.coverage <= 1,
        `${where} = ${r.coverage}`,
      );
      check(`English is empty`, r.english_text.trim().length > 0, where);
    }
  }
  console.log(`\nchecked ${checked} rows; ${missing} whose Arabic was not found`);

  // A translation must never be attached to a Qur'an chunk: the Qur'an already
  // carries its own published translation, and two English texts under one
  // passage with different provenance is exactly the confusion to avoid.
  const onQuran = await query<{ n: string }>(
    `select count(*) as n from chunk_translations t
       join chunks c on c.id = t.chunk_id where c.kind = 'quran'`,
  );
  check(`translations attached to Qur'an chunks`, Number(onQuran[0]!.n) === 0);

  if (failures.length > 0) {
    console.error(`\n${failures.length} failures:`);
    for (const f of failures.slice(0, 25)) console.error(`  - ${f}`);
    if (failures.length > 25) console.error(`  ... and ${failures.length - 25} more`);
    process.exitCode = 1;
  } else {
    console.log("all checks pass");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
