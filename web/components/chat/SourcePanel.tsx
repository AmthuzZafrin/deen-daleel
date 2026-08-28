"use client";

import { RichText } from "@/components/chat/RichText";
import { KIND_LABEL, type CitedIn, type Source } from "@/lib/types";

/**
 * The drawer that opens when a citation is clicked.
 *
 * This is where the app's promise is actually kept: the reader sees the source
 * text itself — Arabic and translation — with its reference and a link out to
 * check it independently. Everything else is presentation around this.
 *
 * The honest difficulty is that "and translation" is true for a fourteenth of
 * the corpus. English exists only for the Qur'an: 6,236 chunks of 140,379, and
 * 158 of the 2,134 passages the answer bank actually cites. Open a hadith, a
 * tafsir or a fiqh manual and `english_text` is null, so the panel used to
 * render nothing but a wall of Arabic and no explanation of why.
 *
 * Three things are done about that, in this order, and none of them invents a
 * translation:
 *
 *   1. The answer's own paragraph about the passage is shown first. It is
 *      English, it was written against this passage, and every quotation in it
 *      is verified verbatim against the chunk -- but it is the answer's
 *      rendering of the part it quoted, not a translation of the whole, and it
 *      is labelled as exactly that.
 *   2. The Arabic is shown with the quoted span marked, so a reader who does
 *      read Arabic can see which words the answer leaned on without hunting,
 *      and a reader who does not can at least see how much of the passage was
 *      used.
 *   3. English follows the Arabic, from two places and never from a model. For
 *      the Qur'an it is the published translation the corpus already carried.
 *      For hadith it is a published translation attached to this chunk by
 *      `ingest/pipelines/hadith_english.py`, which pairs the two only where the
 *      translated Arabic was found in the chunk word for word. That lifts the
 *      cited passages carrying English from 158 to 617 of 2,134, and hadith
 *      specifically from none to 459 of 905.
 *
 * The third is a claim about part of a page and is worded as one. A page of
 * Fath al-Bari quotes the hadith it comments on and then discusses it: the
 * hadith gets its English, al-Asqalani's own words do not, and where the page
 * carries only a fragment the panel says the passage quotes part of the hadith
 * rather than letting the full translation stand in for the passage.
 *
 * What is deliberately absent is machine translation. Running the passages
 * through a local Arabic-English model was tried and the output was not fit to
 * put under a hadith: `رَكْعَة` came back as "knees", Abu Hurayra as "Father
 * Herrera", al-Thawri as "the Revolutionary", the tahlil as "or to Allah, and
 * to Allah is Allah", and one Bukhari passage on ritual purity degenerated into
 * "when I pray, and when I pray, I pray". A reader who cannot read the Arabic
 * cannot tell which parts of that are wrong, and the wrong parts are the
 * religiously consequential ones. A label would not fix it.
 */

interface Props {
  source: Source | null;
  /** Every use of this passage by the answer on screen. Empty for a miss. */
  cited: CitedIn[];
  onClose: () => void;
}

/**
 * Mark the quoted spans inside the full passage.
 *
 * Located by exact substring, the same text `answer_citations.cited_text`
 * stores, and a span that cannot be found is skipped rather than approximated:
 * `arabic_text` sometimes comes from the document and the quote from the chunk,
 * and a highlight on the wrong words is worse than none.
 */
function markQuotes(text: string, quotes: string[]) {
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    const needle = quote.trim();
    if (!needle) continue;
    const at = text.indexOf(needle);
    if (at !== -1) ranges.push([at, at + needle.length]);
  }
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const out = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark
        key={start}
        className="rounded px-0.5"
        style={{ background: "var(--accent-soft)", color: "inherit" }}
      >
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

/** A section heading in the drawer. */
function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </h3>
  );
}

/**
 * Link a Creative Commons attribution to the deed it names.
 *
 * The corpus is CC BY-NC-SA 4.0, which obliges credit to OpenITI and the
 * edition, and asks for the licence URI where practicable. Naming the licence
 * in text satisfies the first; this supplies the second, and is why the
 * attribution sits above the fold with a rule above it rather than trailing off
 * the end of a scroll. It is a condition of using these texts at all, not a
 * footnote.
 *
 * Driven off the attribution string rather than a separate column: every source
 * already states its licence there, and a second field could disagree with what
 * the reader is shown.
 */
function licenseDeed(attribution: string): string | null {
  const cc = /CC\s+(BY(?:-NC)?(?:-SA)?(?:-ND)?)\s+(\d\.\d)/i.exec(attribution);
  if (!cc) return null;
  // The deed path is the whole code lowercased — 'by-nc-sa', not the clauses
  // after BY. A wrong path 404s, which is worse than no link at all: it looks
  // like the terms were stated and cannot be read.
  return `https://creativecommons.org/licenses/${cc[1]!.toLowerCase()}/${cc[2]}/`;
}

export function SourcePanel({ source, cited, onClose }: Props) {
  if (!source) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20 md:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l md:w-[420px]"
        style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
        aria-label="Source detail"
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[0.6875rem] font-medium uppercase tracking-wide"
              style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}
            >
              {KIND_LABEL[source.kind]}
            </span>
            <h2 className="mt-1.5 truncate text-base font-semibold">
              {source.canonicalRef}
            </h2>
            <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              {source.sourceTitle}
            </p>
            {/* Said plainly, because the difference is the reader's to judge.
                A reference with a page can be opened in a printed edition and
                checked; one without narrows the passage to a chapter and no
                further. Presenting both the same way would quietly overstate
                what the weaker one is worth. */}
            {source.chapterLevel && (
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                Chapter-level reference — this digitisation carries no page
                numbers here.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source"
            className="rounded p-1 text-xl leading-none hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
          >
            &times;
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {/* First, because for most of the corpus it is the only English on
              the page. Said as the answer's words, not as a translation. */}
          {cited.some((c) => c.context.length > 0) && (
            <section>
              <Heading>What the answer says about this passage</Heading>
              <div className="space-y-3 whitespace-pre-wrap text-[0.9375rem] leading-7">
                {cited.flatMap((c) =>
                  c.context.map((paragraph, i) => (
                    <p key={`${c.ordinal}-${i}`}>
                      <RichText text={paragraph} />
                    </p>
                  )),
                )}
              </div>
              <p className="mt-2 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                The answer&rsquo;s own words about the part it quoted, not a
                translation of the whole passage.
              </p>
            </section>
          )}

          {source.arabicText && (
            <section>
              <Heading>
                Arabic{cited.length > 0 ? " — quoted words marked" : ""}
              </Heading>
              {/* Rendered from documents.arabic_text — the source text exactly as
                  supplied, fully vocalised. The stripped form exists only in the
                  search index and is never shown. */}
              <p className="arabic" lang="ar" dir="rtl">
                {markQuotes(source.arabicText, cited.map((c) => c.quote))}
              </p>
            </section>
          )}

          {/* Below the Arabic, because that is the order a reader works in:
              the passage is the daleel, the English is how they get at it. */}
          {source.englishText && (
            <section>
              <Heading>Translation</Heading>
              {/* Marked here as well as in the Arabic. A Qur'an citation quotes
                  the *English*, because the Qur'an is the one part of the
                  corpus that arrived with a translation, so the span the answer
                  leaned on is findable in this block and not in the Arabic
                  one. Passing the quotes to both lets each mark what it can. */}
              <p className="text-[0.9375rem] leading-7">
                {markQuotes(source.englishText, cited.map((c) => c.quote))}
              </p>
            </section>
          )}

          {source.translations.length > 0 && (
            <section>
              <Heading>English — the hadith quoted here</Heading>
              <div className="space-y-4">
                {source.translations.map((t) => (
                  <div key={`${t.edition}-${t.hadithNumber}`}>
                    <p
                      className="mb-1 text-xs font-medium"
                      style={{ color: "var(--accent-text)" }}
                    >
                      {t.collection} {t.hadithNumber}
                    </p>
                    {/* The distinction that keeps this honest. Above ~95% the
                        page carries the hadith; below it the page quotes a
                        piece and the translation is of the whole, so saying
                        nothing would let the English stand in for words that
                        are not on the page. */}
                    {t.coverage < 0.95 && (
                      <p
                        className="mb-1 text-xs leading-5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        The passage above quotes part of this hadith. It is given
                        here in full.
                      </p>
                    )}
                    <p className="text-[0.9375rem] leading-7">{t.englishText}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                A published translation, attached to this passage only because the
                Arabic it translates was found in it word for word. Only the hadith
                is translated — any commentary or chapter heading around it is not.
                Nothing here is machine-translated. Text from the public-domain{" "}
                <a
                  href="https://github.com/fawazahmed0/hadith-api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  hadith-api
                </a>{" "}
                collection.
              </p>
            </section>
          )}

          {/* Said plainly rather than left as an unexplained absence. A reader
              looking at Arabic with no English should know that none is held,
              not assume the page failed to load it. */}
          {source.arabicText &&
            !source.englishText &&
            source.translations.length === 0 && (
              <p className="text-xs leading-5" style={{ color: "var(--text-muted)" }}>
                No English translation of this work is held here. The corpus carries
                one for the Qur&rsquo;an, and published translations for the hadith
                collections — the fiqh manuals and tafsir have never been translated
                in full, and nothing on this page is machine-translated.
              </p>
            )}

          {source.attribution && (
            <p
              className="border-t pt-4 text-xs leading-5"
              style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}
            >
              {source.attribution}
              {licenseDeed(source.attribution) && (
                <>
                  {" · "}
                  <a
                    href={licenseDeed(source.attribution)!}
                    target="_blank"
                    rel="license noopener noreferrer"
                    className="underline"
                  >
                    licence terms
                  </a>
                </>
              )}
              {". "}
              Shown as an excerpt of the digitised edition.
            </p>
          )}
        </div>

        {source.permalink && (
          <footer
            className="border-t px-5 py-3"
            style={{ borderColor: "var(--border)" }}
          >
            <a
              href={source.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium hover:underline"
              style={{ color: "var(--accent-text)" }}
            >
              Verify on the source site &rarr;
            </a>
          </footer>
        )}
      </aside>
    </>
  );
}
