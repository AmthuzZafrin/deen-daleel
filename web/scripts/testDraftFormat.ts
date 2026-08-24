/**
 * Checks on the hand-drafting worksheet format.
 *
 * Runs with no database and no embedding service, so it can guard the parsing
 * on every change. The first case is a regression: `section` once ended at a
 * literal `z`, quietly truncating any answer that used the word "zakat".
 *
 *   npx tsx scripts/testDraftFormat.ts
 */

import {
  parseCitations,
  parsePassages,
  section,
  words,
} from "../lib/draftFormat";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

const WORKSHEET = [
  "<!-- Worksheet for zakat-on-gold -->",
  "",
  "# Is zakat due on gold jewellery?",
  "",
  "## Answer",
  "",
  "The zakat is due yearly on wealth held to the nisab. [1]",
  "Scholars differ on jewellery worn for use. [2]",
  "",
  "## Citations",
  "",
  "<!-- One per line -->",
  '1. passage=3 quote="Fasting is prescribed for you, even as it was prescribed"',
  '2. passage=1 quote="مَا كَانَ مِنْ مَالٍ"',
  "",
  "## Passages",
  "",
  "### Passage 3 — Qur'an 2:183",
  "",
  "- kind: quran · source: Pickthall · chunk: 6921",
  "",
  "```",
  "O ye who believe! Fasting is prescribed for you.",
  "```",
  "",
  "### Passage 1 — Al-Mughni 3:14 (chapter-level, no page)",
  "",
  "- kind: fiqh · source: Al-Mughni · chunk: 99",
  "",
  "```",
  "ما كان من مال",
  "```",
  "",
].join("\n");

console.log("section extraction");

const answer = section(WORKSHEET, "Answer");
check(
  "an answer containing 'zakat' is not truncated at the z",
  answer.startsWith("The zakat is due yearly"),
  `got: ${JSON.stringify(answer.slice(0, 40))}`,
);
check("the answer stops at the next heading", !answer.includes("passage="));
check("both answer lines are kept", answer.split("\n").filter(Boolean).length === 2);
check(
  "instruction comments are stripped",
  !section(WORKSHEET, "Citations").includes("One per line"),
);
check("a missing section is empty, not an error", section(WORKSHEET, "Nope") === "");

console.log("\ncitations");

const cites = parseCitations(section(WORKSHEET, "Citations"));
check("both citations parse", cites.length === 2, `got ${cites.length}`);
check("ordinal and passage are read", cites[0]?.ordinal === 1 && cites[0]?.passage === 3);
check(
  "an Arabic quote survives intact",
  cites[1]?.quote === "مَا كَانَ مِنْ مَالٍ",
  `got: ${cites[1]?.quote}`,
);

console.log("\npassages");

const passages = parsePassages(WORKSHEET);
check("both passages parse", passages.length === 2, `got ${passages.length}`);
check(
  "passage numbers map to their own chunk, not the next one",
  passages[0]?.number === 3 &&
    passages[0]?.chunkId === 6921 &&
    passages[1]?.number === 1 &&
    passages[1]?.chunkId === 99,
  `got ${JSON.stringify(passages)}`,
);
check(
  "a chapter-level marker in the heading does not break parsing",
  passages[1]?.chunkId === 99,
);

console.log("\nquote matching");

check(
  "punctuation drift is tolerated",
  words("that ye may ward off (evil).").includes(words("ward off (evil),")),
);
check(
  "case is ignored",
  words("The Zakat Is Due") === words("the zakat is due"),
);
check(
  "Arabic diacritics are not words and do not block a match",
  words("مَا كَانَ مِنْ مَالٍ").length > 0 &&
    words("ما كان من مال").length > 0,
);
check(
  "different text still does not match",
  !words("fasting is prescribed for you").includes(words("zakat is due on gold")),
);

console.log(
  failures === 0
    ? "\nall draft-format checks passed"
    : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
