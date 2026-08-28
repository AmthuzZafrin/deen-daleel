/**
 * Checks on the inline renderer for the answer bank's markdown dialect.
 *
 * This parser decides what every reader sees, so the case that matters most is
 * the last one: parse all 488 published bodies and assert that no character of
 * prose is lost. A tokeniser that silently drops text is the failure that would
 * never be noticed -- an answer would simply be missing a clause -- and it is
 * exactly what a badly bounded emphasis pattern does.
 *
 * Runs with no embedding service. Needs the database only for the last case,
 * which is skipped if it cannot connect.
 *
 *   npx tsx scripts/testAnswerText.ts
 */

import { citationParagraphs, parseInline, type Inline } from "../lib/answerText";
import { query } from "../lib/db";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

function kinds(text: string): string[] {
  return parseInline(text).map((n) => n.kind);
}

/** Everything the parser would put on the page, markup removed. */
function visible(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case "text":
        case "arabic":
        case "code":
          return n.text;
        case "cite":
          return "";
        default:
          return visible(n.children);
      }
    })
    .join("");
}

/**
 * The same string reduced to the letters that must survive.
 *
 * Asterisks and backticks come off both sides rather than only the source,
 * because some are not markup at all: three of the fiqh passages carry a
 * literal `*` inside the Arabic as an editorial separator, and the parser is
 * right to leave it alone. Normalising both sides keeps the check on the thing
 * it is for -- prose disappearing -- instead of failing on punctuation.
 */
function letters(text: string): string {
  return text
    .replace(/\[\d{1,3}\]/g, "")
    .replace(/[*`]/g, "");
}

check("plain text is one node", kinds("hello").join() === "text");

check(
  "a backticked Arabic term becomes an inline Arabic run",
  JSON.stringify(parseInline("the root of `ربا` is increase")) ===
    JSON.stringify([
      { kind: "text", text: "the root of " },
      { kind: "arabic", text: "ربا", block: false },
      { kind: "text", text: " is increase" },
    ]),
);

check(
  "a long Arabic quotation is set as its own block",
  (parseInline(
    "he said: `وأصل الربا الزيادة يقال ربا الشئ يربو إذا زاد وأربى الرجل وأرمى عامل بالربا`",
  )[1] as { block: boolean }).block,
);

check(
  "a backticked span with no Arabic stays a code span",
  kinds("set `NODE_ENV` first").includes("code"),
);

check("a citation marker is its own node", kinds("...ankles. [1]").includes("cite"));

check(
  "a bracketed reference that is not a bare ordinal is left alone",
  !kinds("see Qur'an [2:275]").includes("cite"),
);

// The regression this file exists for. Answers are stored hard-wrapped, so an
// italicised verse is nearly always split across lines; an emphasis pattern
// that stops at a newline leaves the asterisks on the page.
check(
  "emphasis survives a wrapped line",
  kinds("*When ye rise up for prayer,\nwash your faces.* Four things") .includes("em"),
);

check(
  "emphasis does not run across a blank line",
  !kinds("an *unclosed emphasis\n\nand a later * asterisk").includes("em"),
);

check(
  "bold containing a backticked term nests rather than showing backticks",
  JSON.stringify(parseInline("**`الربا` means increase.**")) ===
    JSON.stringify([
      {
        kind: "strong",
        children: [
          { kind: "arabic", text: "الربا", block: false },
          { kind: "text", text: " means increase." },
        ],
      },
    ]),
);

check(
  "a paragraph is found by its marker and not by its neighbours",
  citationParagraphs("first [1]\n\nsecond [2]\n\nthird [1] again", 1).length === 2,
);

check(
  "an ordinal the body never uses yields nothing",
  citationParagraphs("first [1]\n\nsecond [2]", 9).length === 0,
);

async function main() {
  try {
    const rows = await query<{ slug: string; body: string }>(
      `select slug, body from answers where status = 'published'`,
    );
    let lossy = 0;
    let example = "";
    for (const row of rows) {
      if (letters(visible(parseInline(row.body))) !== letters(row.body)) {
        lossy++;
        if (!example) example = row.slug;
      }
    }
    check(
      `no prose is dropped across ${rows.length} published bodies`,
      lossy === 0,
      lossy > 0 ? `${lossy} answers lose text, first: ${example}` : undefined,
    );

    /* The other half of the same worry. Normalising asterisks away above means
       a stranded `**` no longer registers as loss, and a stranded one is
       markup the reader sees. It is nearly always a malformed answer rather
       than a parser fault -- `disposing-of-old-quran` had an extra asterisk in
       "the burner of the *masahif*" that unbalanced the rest of its
       paragraph -- so this points at the draft to fix. */
    let stranded = 0;
    let strandedExample = "";
    for (const row of rows) {
      if (visible(parseInline(row.body)).includes("**")) {
        stranded++;
        if (!strandedExample) strandedExample = row.slug;
      }
    }
    check(
      "no answer leaves a bold marker on the page",
      stranded === 0,
      stranded > 0
        ? `${stranded} answers show literal '**', first: ${strandedExample}`
        : undefined,
    );
  } catch (err) {
    console.log(`  SKIP  corpus round-trip (no database: ${(err as Error).message})`);
  }

  console.log(
    failures === 0
      ? "\nall answer-text checks passed"
      : `\n${failures} check(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
