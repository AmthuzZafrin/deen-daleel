/**
 * Arabic normalisation — the TypeScript half of a two-language pair.
 *
 * This MUST stay byte-for-byte equivalent to `ingest/normalize_ar.py`. The
 * corpus is normalised at ingest time by the Python module; queries are
 * normalised here at search time. If the two ever diverge, Arabic lexical
 * search silently returns nothing — no error, just quietly worse answers.
 *
 * `scripts/checkNormalizerParity.ts` asserts the two agree; run it after
 * touching either file.
 */

// U+064B-065F tanween/harakat/shadda/sukun, U+0670 dagger alef,
// U+06D6-06ED Qur'anic annotation marks, U+0640 tatweel.
const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g;

// End-of-ayah sign, start-of-rub marks, sajdah, and ornate parentheses.
const QURANIC_MARKUP = /[۝۞۩﴾﴿]/g;

// Zero-width and bidi controls that survive copy-paste and would split words.
const ZERO_WIDTH = /[​-‏‪-‮⁠﻿]/g;

const ARABIC_CHAR = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

const WHITESPACE = /\s+/g;

// Orthographic variants readers treat as the same letter. Ta marbuta folds to
// ha, matching the Python side's choice.
const FOLD: Record<string, string> = {
  "آ": "ا", // آ -> ا
  "أ": "ا", // أ -> ا
  "إ": "ا", // إ -> ا
  "ٱ": "ا", // ٱ -> ا
  "ى": "ي", // ى -> ي
  "ة": "ه", // ة -> ه
  "ؤ": "و", // ؤ -> و
  "ئ": "ي", // ئ -> ي
};

function foldLetters(text: string): string {
  let out = "";
  for (const ch of text) out += FOLD[ch] ?? ch;
  return out;
}

function foldDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0660 && cp <= 0x0669) out += String(cp - 0x0660);
    else if (cp >= 0x06f0 && cp <= 0x06f9) out += String(cp - 0x06f0);
    else out += ch;
  }
  return out;
}

/** Fold Arabic text into the same search form the corpus was indexed with. */
export function normalizeArabic(text: string | null | undefined): string {
  if (!text) return "";
  let out = text.normalize("NFC");
  out = out.replace(ZERO_WIDTH, "");
  out = out.replace(QURANIC_MARKUP, " ");
  out = out.replace(DIACRITICS, "");
  out = foldLetters(out);
  out = foldDigits(out);
  return out.replace(WHITESPACE, " ").trim();
}

export function hasArabic(text: string | null | undefined): boolean {
  return !!text && ARABIC_CHAR.test(text);
}

/**
 * Normalise a user's query.
 *
 * Latin text is left alone apart from whitespace: case folding and stemming are
 * Postgres' job via the English text-search configuration, and doing it here too
 * would only desynchronise the two.
 */
export function normalizeQuery(text: string): string {
  if (!text) return "";
  let out = text.normalize("NFC").replace(ZERO_WIDTH, "");
  if (hasArabic(out)) out = normalizeArabic(out);
  return out.replace(WHITESPACE, " ").trim();
}
