/**
 * The small markdown dialect the answer bank is actually written in.
 *
 * Answers are drafted offline into `content/drafts/*.md` and stored verbatim,
 * so what reaches the reader is whatever the worksheet contained: `**bold**`,
 * `*italic*`, backticked spans that are nearly always Arabic quotations, and a
 * `[1]`-style marker after each one. The UI used to render only `**bold**`,
 * which meant every backtick reached the page as a literal backtick and every
 * Arabic quotation was set LTR in the body font, inside an English sentence.
 *
 * There is no markdown library here on purpose. A general engine would also
 * bring link, image and raw-HTML handling into a page that renders text written
 * by a drafting model, and none of those are wanted. This handles the four
 * constructs the corpus uses and treats everything else as plain text.
 */

/** Arabic and Arabic Supplement. Enough to tell a quotation from a code span. */
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

/**
 * An Arabic run longer than this is set as its own block rather than inline.
 *
 * Short runs are terms inside a sentence -- `الربا` means increase -- and
 * belong in the line. Long ones are the quotation the citation points at, and
 * inlining a 200-character right-to-left run inside a left-to-right paragraph
 * produces a wall of text with the English wrapped around it in fragments.
 */
const BLOCK_ARABIC_CHARS = 60;

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "arabic"; text: string; block: boolean }
  | { kind: "code"; text: string }
  | { kind: "cite"; ordinal: number }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] };

/* `**` before `*`, or every bold span parses as two empty italics. The citation
   marker is digits only, so a bracketed aside in the prose is left alone.

   Emphasis may run across a line break -- answers are stored hard-wrapped at
   about eighty columns, so a quoted verse set in italics is nearly always split
   over three or four lines -- but never across a blank one. Without that
   allowance the whole construct silently fails and the asterisks reach the
   page; without the limit, a single unpaired asterisk would italicise the rest
   of the answer. */
const LINE = "\\n(?!\\s*\\n)";

/* Bold tolerates asterisks inside it, because a bold lead-in routinely
   italicises a phrase within itself, and often ends on the same word:

     "everything that benefits is *tayyib*, and everything that harms is
     *khabith*"

   which closes as `***`. The closing `\*\*(?!\*)` is what makes that come out
   right: forbidding a third asterisk after the close stops the engine settling
   on the first two of the run and stranding the third on the page. Between the
   two rules, the eighty-five answers that lost their emphasis and the
   twenty-four that stranded an asterisk both round-trip.

   Italic stops at the next asterisk; nesting the other way round does not
   occur in the bank. Neither may cross a blank line -- without that limit a
   single unpaired asterisk would emphasise the rest of the answer. */
const ITALIC = `(?:[^*\\n]|\\*\\*|${LINE})+?`;
const BOLD = `(?:[^\\n]|${LINE})+?`;
const TOKEN = new RegExp(
  `\\*\\*(${BOLD})\\*\\*(?!\\*)|\\*(${ITALIC})\\*(?!\\*)|\`([^\`]+?)\`|\\[(\\d{1,3})\\]`,
  "g",
);

export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let last = 0;

  // A fresh regex per call: `TOKEN` is global and stateful, and recursion would
  // otherwise resume mid-string in the parent's scan.
  const re = new RegExp(TOKEN.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });

    if (m[1] !== undefined) {
      out.push({ kind: "strong", children: children(m[1], depth) });
    } else if (m[2] !== undefined) {
      out.push({ kind: "em", children: children(m[2], depth) });
    } else if (m[3] !== undefined) {
      out.push(
        ARABIC.test(m[3])
          ? { kind: "arabic", text: m[3], block: m[3].length > BLOCK_ARABIC_CHARS }
          : { kind: "code", text: m[3] },
      );
    } else {
      out.push({ kind: "cite", ordinal: Number(m[4]) });
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/* Emphasis nests one level in practice -- a bold lead-in containing a backticked
   term -- and the cap stops a pathological body from recursing without end. */
function children(text: string, depth: number): Inline[] {
  return depth >= 2 ? [{ kind: "text", text }] : parseInline(text, depth + 1);
}

/**
 * The answer's own English about one cited passage.
 *
 * This is the whole reason the source panel can show English at all. The corpus
 * holds a translation only for the Qur'an -- 6,236 of 140,379 chunks -- so for
 * a hadith, a tafsir or a fiqh manual there is no English column to read from
 * and no honest way to invent one. What does exist is the answer itself, which
 * renders every passage it quotes into English in the paragraph that carries
 * the marker:
 *
 *     Al-Nawawi begins where the word does: `وأصل الربا الزيادة ...` [1] --
 *     the root of `ربا` is increase; the Muslims have agreed on its
 *     prohibition **in general terms, while differing over its definition**.
 *
 * So the paragraph is returned whole and labelled as what it is: the answer's
 * words about the passage, not a translation of it. Every one of the 488
 * published answers carries these markers, and the marker is exact, which makes
 * this reliable in a way that guessing at the bold span before it was not.
 */
export function citationParagraphs(body: string, ordinal: number): string[] {
  const marker = `[${ordinal}]`;
  return body
    .split(/\n\s*\n/)
    .filter((p) => p.includes(marker))
    .map((p) => p.trim())
    .filter(Boolean);
}
