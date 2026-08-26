/**
 * The editorial sections, read from `content/questions.yaml`.
 *
 * The 24 sections exist only as comment banners in that file — `# 1. Brand new
 * / revert-specific` — and comments do not survive YAML parsing, so they are
 * recovered by scanning the raw text. That is deliberate rather than lazy: the
 * grouping is editorial, it changes when the question list changes, and copying
 * it into a database column would create a second place to keep in sync and a
 * migration to run every time the banners move.
 *
 * Server-only. Reads the repository, so it must never be imported by a client
 * component.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export interface Section {
  /** 1-based, as written in the banner. */
  index: number;
  /** The banner text with its number stripped: "Brand new / revert-specific". */
  title: string;
}

/** `# 12. Belief and aqidah` — the number is what distinguishes a banner from an ordinary comment. */
const BANNER = /^#\s*(\d+)\.\s*(.+?)\s*$/;
const SLUG = /^-\s*slug:\s*(\S+)\s*$/;

const QUESTIONS_PATH = path.join(
  process.cwd(),
  "..",
  "content",
  "questions.yaml",
);

let cache: Map<string, Section> | null = null;

/**
 * Map every question slug to the section it sits under.
 *
 * Cached for the life of the process. The review page is the only caller and
 * the file changes only when questions are edited, which is a restart anyway.
 * A slug that appears before any banner is simply absent from the map — callers
 * treat that as "ungrouped" rather than failing, since a missing section should
 * never stop a reviewer reading an answer.
 */
export function sectionsBySlug(): Map<string, Section> {
  if (cache) return cache;

  const map = new Map<string, Section>();
  let current: Section | null = null;

  let text: string;
  try {
    text = readFileSync(QUESTIONS_PATH, "utf-8");
  } catch {
    // Grouping is a convenience; losing it must not take the review page down.
    cache = map;
    return map;
  }

  for (const line of text.split("\n")) {
    const banner = BANNER.exec(line);
    if (banner) {
      current = { index: Number(banner[1]), title: banner[2]! };
      continue;
    }
    const slug = SLUG.exec(line);
    if (slug && current) map.set(slug[1]!, current);
  }

  cache = map;
  return map;
}
