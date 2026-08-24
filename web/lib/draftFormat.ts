/**
 * The worksheet format used to draft answers by hand.
 *
 * Kept apart from `scripts/draft.ts` so the parsing can be tested without a
 * database or an embedding service. It earns that separation: the first version
 * of `section` used `\z` for end-of-input, which JavaScript does not have — it
 * reads as a literal `z` — so an answer reading "The zakat is due yearly"
 * silently stored as "The ". Nothing about that failure looks like a failure
 * until a reader sees the truncated answer.
 */

/** One passage offered to the drafter, and the chunk it came from. */
export interface WorksheetPassage {
  number: number;
  chunkId: number;
}

/** One citation the drafter wrote, before it is checked against its passage. */
export interface WorksheetCitation {
  ordinal: number;
  passage: number;
  quote: string;
}

/**
 * The body of one `## Heading` section.
 *
 * Walks lines rather than using a lookahead: headings are line-anchored, and
 * the end of the section is either the next heading or the end of the file.
 * HTML comments are stripped, since the worksheet uses them for instructions.
 */
export function section(body: string, name: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("## ")) {
      if (inside) break;
      inside = line.slice(3).trim() === name;
      continue;
    }
    if (inside) out.push(line);
  }
  return out
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

/**
 * Passage number → chunk id, read back from the `## Passages` section.
 *
 * This is what confines a citation to evidence actually retrieved for the
 * question: `commit` will not accept a passage number that is not listed here.
 */
export function parsePassages(body: string): WorksheetPassage[] {
  const re = /^### Passage (\d+) —[\s\S]*?^- kind: .*? chunk: (\d+)\s*$/gm;
  return [...body.matchAll(re)].map((m) => ({
    number: Number(m[1]),
    chunkId: Number(m[2]),
  }));
}

/** Citations written as `N. passage=P quote="..."`, one per line. */
export function parseCitations(citationsSection: string): WorksheetCitation[] {
  const re = /^\s*(\d+)\.\s*passage=(\d+)\s+quote="([\s\S]*?)"\s*$/gm;
  return [...citationsSection.matchAll(re)].map((m) => ({
    ordinal: Number(m[1]),
    passage: Number(m[2]),
    quote: m[3]!.trim(),
  }));
}

/**
 * Reduce text to its words for comparison: lowercased, punctuation removed,
 * whitespace collapsed.
 *
 * Punctuation is where a quotation and its source drift apart without either
 * being wrong — a citation of Qur'an 2:183 ending 'ward off (evil).' against a
 * text ending 'ward off (evil),'. Unicode-aware, so it treats Arabic the same
 * way it treats English.
 */
export function words(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
