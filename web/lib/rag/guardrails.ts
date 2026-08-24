/**
 * Post-generation grounding check.
 *
 * Native citations make it structurally hard for the model to cite a source it
 * was not given, but they do not stop it from *mentioning* a reference in prose
 * without attaching a citation to it — "as the Prophet ﷺ said in Bukhari…"
 * with no span behind it.
 *
 * That is the single failure mode that would most damage trust in this app, so
 * it is checked explicitly and surfaced in the UI rather than logged and
 * forgotten. This is a cheap safety net, not a substitute for the citation
 * mechanism itself.
 */

/** `2:255`, `Qur'an 2:255`, `Surah 4:101` — with or without the word. */
const QURAN_REF = /\b(\d{1,3}):(\d{1,3})\b/g;

/**
 * Named collections referenced in prose.
 *
 * Split in two because "Muslim" and "Ahmad" are ordinary words here — a
 * person's faith and a person's name — long before they are book titles. Read
 * bare, they fired on "every adult Muslim who is able to keep it", which is a
 * sentence this app will write constantly. A guardrail that flags every answer
 * gets ignored, and an ignored guardrail does not catch the case it exists for.
 *
 * So the unambiguous titles match on their own, and the two ambiguous ones only
 * when something marks them as a source: `Sahih Muslim`, `narrated by Muslim`,
 * `Muslim 2:788`.
 */
const HADITH_COLLECTION =
  /\b(Bukhari|Abu\s?Dawud|Tirmidhi|Nasa'?i|Ibn\s?Majah|Muwatta|Bayhaqi|Darimi)\b/gi;

const HADITH_AMBIGUOUS =
  /(?:\b(?:Sahih|Musnad|narrated\s+(?:by|in)|reported\s+(?:by|in)|related\s+by|collected\s+(?:by|in))\s+(Muslim|Ahmad)\b)|\b(Muslim|Ahmad)\s+\d{1,3}:\d{1,4}\b/gi;

export interface UnverifiedReference {
  text: string;
  kind: "quran" | "hadith";
}

export interface GroundingReport {
  /** References that appear in the prose but in no citation span. */
  unverified: UnverifiedReference[];
  /** True when the answer made claims but attached no citations at all. */
  uncited: boolean;
}

/**
 * Collapse runs of whitespace to single spaces.
 *
 * Answers are hand-wrapped, so a source name routinely straddles a line break —
 * "in Sahih\nMuslim". Matched literally against a canonical ref that has a
 * single space, that reads as an ungrounded reference and the answer gets
 * flagged for a reviewer who will find nothing wrong with it. Both sides are
 * flattened before comparing.
 */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * Fold transliteration variants of a collector's name.
 *
 * A canonical ref reads `Sunan Abi Dawud 3:476-477`; prose reads "Abu Dawud",
 * which is how the name is normally written in English. Compared literally that
 * is an ungrounded reference, and the answer gets flagged for a reviewer who
 * opens it and finds the citation sitting right there. The grammatical case of
 * an Arabic name is not evidence of anything, so both sides are folded to one
 * form before comparing.
 */
function foldNames(text: string): string {
  return text.replace(/\bab[uio]\b/gi, "abu");
}

function collect(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => flatten(m[0]));
}

/**
 * Compare the prose against the text actually covered by citations.
 *
 * `citedTexts` are the `cited_text` spans returned by the API, and
 * `citedTitles` the canonical refs of the sources those spans came from — a
 * reference counts as verified if it appears in either.
 */
export function checkGrounding(
  answer: string,
  citedTexts: string[],
  citedTitles: string[],
): GroundingReport {
  const haystack = foldNames(flatten([...citedTexts, ...citedTitles].join("\n")));

  const unverified: UnverifiedReference[] = [];
  const seen = new Set<string>();

  for (const [re, kind] of [
    [QURAN_REF, "quran"],
    [HADITH_COLLECTION, "hadith"],
    [HADITH_AMBIGUOUS, "hadith"],
  ] as const) {
    for (const ref of collect(re, answer)) {
      const key = `${kind}:${ref.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const found =
        kind === "quran"
          ? haystack.includes(ref)
          : haystack.toLowerCase().includes(foldNames(ref).toLowerCase());

      if (!found) unverified.push({ text: ref, kind });
    }
  }

  // A short deflection ("that needs a scholar who knows your situation")
  // legitimately has no citations; a long substantive answer with none does not.
  const substantive = answer.trim().length > 400;

  return { unverified, uncited: substantive && citedTexts.length === 0 };
}
