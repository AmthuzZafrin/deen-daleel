/**
 * Check candidate quotations against the chunks they claim, before writing them
 * into an answer.
 *
 *   npx tsx scripts/checkQuotes.ts quotes.txt
 *
 * One per line, `chunkId::the exact words`. Comparison is on words only —
 * lowercased, punctuation stripped, whitespace collapsed — exactly as
 * `draft.ts commit` does it, so a line that passes here will pass there.
 *
 * Why this exists as a separate step: `commit` rejects the whole answer when a
 * quotation is off by a word, which means discovering it after the prose is
 * written and the citation numbering has settled. Checking the quotations first
 * turns that into a ten-second loop. Drafting the revert-specific section,
 * several candidates failed here — an Arabic phrase that turned out to span a
 * page break, a Pickthall rendering misremembered by one word — and none of
 * them reached an answer.
 */

import "dotenv/config";

import { readFileSync } from "node:fs";

import { pool, query } from "../lib/db";
import { words } from "../lib/draftFormat";

async function main() {
  const path = process.argv[2];
  if (!path) {
    throw new Error("usage: checkQuotes.ts <file of chunkId::quote lines>");
  }

  let failures = 0;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const [id, ...rest] = line.split("::");
    const quote = rest.join("::");
    if (!quote) {
      console.log(`BAD   ${line.slice(0, 60)}  (expected chunkId::quote)`);
      failures++;
      continue;
    }

    const rows = await query<{ content: string; ref: string }>(
      `select c.content,
              coalesce(nullif(c.canonical_ref, ''), d.canonical_ref) as ref
         from chunks c join documents d on d.id = c.document_id
        where c.id = $1`,
      [Number(id)],
    );
    const row = rows[0];
    if (!row) {
      console.log(`GONE  ${id}  no such chunk`);
      failures++;
      continue;
    }

    if (words(row.content).includes(words(quote))) {
      console.log(`ok    ${row.ref}  ${quote.slice(0, 60)}`);
    } else {
      console.log(`MISS  ${row.ref}  ${quote.slice(0, 60)}`);
      failures++;
    }
  }

  await pool.end();
  if (failures > 0) {
    console.log(`\n${failures} quotation(s) would be rejected by commit`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
