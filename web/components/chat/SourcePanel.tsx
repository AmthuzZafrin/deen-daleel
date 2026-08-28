"use client";

import { KIND_LABEL, type Source } from "@/lib/types";

/**
 * The drawer that opens when a citation is clicked.
 *
 * This is where the app's promise is actually kept: the reader sees the source
 * text itself — Arabic and translation — with its reference and a link out to
 * check it independently. Everything else is presentation around this.
 */

interface Props {
  source: Source | null;
  onClose: () => void;
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

export function SourcePanel({ source, onClose }: Props) {
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
          {source.arabicText && (
            <section>
              <h3
                className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                Arabic
              </h3>
              {/* Rendered from documents.arabic_text — the source text exactly as
                  supplied, fully vocalised. The stripped form exists only in the
                  search index and is never shown. */}
              <p className="arabic" lang="ar" dir="rtl">
                {source.arabicText}
              </p>
            </section>
          )}

          {source.englishText && (
            <section>
              <h3
                className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                Translation
              </h3>
              <p className="text-[0.9375rem] leading-7">{source.englishText}</p>
            </section>
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
