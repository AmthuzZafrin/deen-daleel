/**
 * Verify citation reconciliation and the grounding guardrail against real
 * retrieved chunks, using synthetic API responses.
 *
 * This covers the step between "the model answered" and "the user sees a
 * clickable daleel" without needing an API key. A mis-mapped citation is the
 * worst bug this app can have — it renders as a confident, wrong reference —
 * and it is invisible to a typecheck.
 *
 *   DEEN_OFFLINE=1 npx tsx scripts/testCitations.ts
 */

import "dotenv/config";

import { pool } from "../lib/db";
import { reconcileCitations, toSearchResults } from "../lib/rag/citations";
import { checkGrounding } from "../lib/rag/guardrails";
import { retrieve, type RetrievedChunk } from "../lib/rag/retrieve";

let failures = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const chunks = await retrieve("fasting during the month of Ramadan", {
    topK: 12,
  });

  if (chunks.length === 0) {
    console.error("no chunks retrieved — ingest the corpus first");
    process.exit(1);
  }
  console.log(`retrieved ${chunks.length} chunk(s) for the fixtures\n`);

  // --- outgoing block shape ------------------------------------------------

  console.log("search_result blocks sent to the model");
  const blocks = toSearchResults(chunks);
  const first = blocks[0];
  check("type is search_result", first.type === "search_result");
  check("source encodes the chunk id", first.source === `chunk:${chunks[0].chunkId}`);
  check("title is the canonical ref", first.title === chunks[0].canonicalRef);
  check("citations are enabled", first.citations.enabled === true);
  check(
    "content is a text block array",
    Array.isArray(first.content) && first.content[0].type === "text",
  );
  check(
    "every block carries a distinct source",
    new Set(blocks.map((b) => b.source)).size === blocks.length,
  );

  // --- reconciliation ------------------------------------------------------

  console.log("\ncitation reconciliation");
  const target = chunks[0];
  const other = chunks[1] ?? chunks[0];

  const response = [
    { type: "text", text: "Fasting Ramadan is obligatory.", citations: null },
    {
      type: "text",
      text: "The month of Ramadan in which was revealed the Qur'an",
      citations: [
        {
          type: "search_result_location",
          source: `chunk:${target.chunkId}`,
          title: target.canonicalRef,
          cited_text: "The month of Ramadan in which was revealed the Qur'an",
          search_result_index: 0,
        },
      ],
    },
    {
      type: "text",
      text: " and a second point.",
      citations: [
        // Same span again — must not produce a duplicate [n].
        {
          type: "search_result_location",
          source: `chunk:${target.chunkId}`,
          cited_text: "The month of Ramadan in which was revealed the Qur'an",
          search_result_index: 0,
        },
        // No `source`: must fall back to search_result_index.
        {
          type: "search_result_location",
          cited_text: "a different span",
          search_result_index: chunks.indexOf(other),
        },
        // Points at a chunk we never sent: must be dropped, not guessed.
        {
          type: "search_result_location",
          source: "chunk:999999999",
          cited_text: "fabricated",
        },
      ],
    },
  ];

  const citations = reconcileCitations(response, chunks);

  check("de-duplicates a repeated span", citations.length === 2, `got ${citations.length}`);
  check("ordinals are 1-based and sequential", citations.every((c, i) => c.ordinal === i + 1));
  check("resolves by source string", citations[0]?.chunkId === target.chunkId);
  check("carries the canonical ref", citations[0]?.canonicalRef === target.canonicalRef);
  check(
    "falls back to search_result_index when source is absent",
    citations[1]?.chunkId === other.chunkId,
  );
  check(
    "drops citations to chunks that were never sent",
    !citations.some((c) => c.citedText === "fabricated"),
  );

  // --- guardrail -----------------------------------------------------------

  console.log("\ngrounding guardrail");

  const cited = citations.map((c) => c.citedText);
  const titles = citations.map((c) => c.canonicalRef);

  const clean = checkGrounding(
    `As stated in ${target.canonicalRef}, fasting is obligatory.`,
    cited,
    titles,
  );
  check("a cited reference is not flagged", clean.unverified.length === 0);

  // A canonical ref reads `Sunan Abi Dawud`; English prose reads "Abu Dawud".
  // Compared literally that flagged 21 answers in the bank, every one of which
  // had the citation sitting right there.
  const transliterated = checkGrounding(
    "The collection glosses it — see Abu Dawud on the point.",
    ["irrelevant span"],
    ["Sunan Abi Dawud 3:476-477"],
  );
  check(
    "a transliteration variant of a collector's name is not flagged",
    transliterated.unverified.length === 0,
  );

  const fabricated = checkGrounding(
    "The Prophet said this in Bukhari, and see also 9:118 on the matter.",
    cited,
    titles,
  );
  check(
    "flags a hadith collection named with no citation",
    fabricated.unverified.some((u) => u.kind === "hadith"),
  );
  check(
    "flags an uncited Qur'an reference",
    fabricated.unverified.some((u) => u.text === "9:118"),
  );

  const longUncited = checkGrounding("x".repeat(500), [], []);
  check("flags a long answer with no citations at all", longUncited.uncited);

  const shortDeflection = checkGrounding(
    "That depends on circumstances only a scholar who knows your situation can weigh.",
    [],
    [],
  );
  check(
    "does not flag a short deflection for having no citations",
    !shortDeflection.uncited,
  );

  console.log(
    failures === 0
      ? "\nall citation checks passed"
      : `\n${failures} check(s) failed`,
  );
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
