"use client";

import { useMemo } from "react";

import { RichText } from "@/components/chat/RichText";
import { FATWA_DISCLAIMER } from "@/lib/rag/prompt";
import type {
  Alternative,
  AnswerMeta,
  Citation,
  Grounding,
  Source,
} from "@/lib/types";

/**
 * Renders an answer with its citations attached inline.
 *
 * The marker is the one the answer was drafted with. This used to work the
 * other way round -- `citedText` was searched for in the prose and a marker
 * inserted where it was found -- on the assumption that a quoted span is
 * English text lifted from the answer. It is not: `answer_citations.cited_text`
 * holds the *Arabic* of the passage, straight out of the chunk, and outside the
 * Qur'an it never appears in an English answer body at all. Measured across the
 * bank, 4,163 of 5,149 citations failed to locate and rendered no marker, while
 * the 986 that matched drew a second marker beside the `[n]` already written in
 * the text -- so the reader saw `...وتفاريعه1 [1]`.
 *
 * Every one of the 488 published answers carries its own markers and every
 * ordinal resolves, so they are simply rendered as buttons where they stand. An
 * ordinal with no citation behind it is dropped rather than drawn dead.
 */

interface Props {
  content: string;
  citations?: Citation[];
  grounding?: Grounding;
  sources?: Source[];
  onCite: (chunkId: number) => void;
  /** False when no reviewed answer covered the question — see NoMatchNotice. */
  matched?: boolean;
  answer?: AnswerMeta;
  /** Answers the matcher could not separate from this one. */
  alternatives?: Alternative[];
  /** False when the match was weak — shown to the reader, not hidden. */
  confident?: boolean;
  /** Ask one of the alternatives instead. */
  onAsk?: (question: string) => void;
}

export function Answer({
  content,
  citations = [],
  grounding,
  onCite,
  matched = true,
  answer,
  alternatives = [],
  confident = true,
  onAsk,
}: Props) {
  const byOrdinal = useMemo(
    () => new Map(citations.map((c) => [c.ordinal, c])),
    [citations],
  );

  return (
    <div className="space-y-3">
      {/* Near-ties, above the answer rather than below it.

          The matcher scores an answer against each stored phrasing of its
          question and serves the highest. Across the eval set that ordering is
          good and the score itself is not: `wiping-over-shoes` beat
          `wiping-over-socks` by 0.001, and the ruling for a Muslim woman
          marrying a non-Muslim beat nothing at all because the ruling for a
          Muslim *man* — which is the opposite ruling — came first by 0.10.
          Served as a single confident answer, that is a coin flip the reader
          cannot see.

          So the runner-up is not hidden and not made into a blocking question:
          the reader gets an answer immediately, and sees the question it might
          have been instead before reading a word of it. Two questions side by
          side is a distinction a person settles at a glance and the
          cross-encoder could not settle at all. */}
      {/* A weak match, said out loud.

          The matcher serves anything clearing a low bar, because measuring
          showed that raising the bar lost more right answers than it prevented
          wrong ones. What it must not do is present a 0.2 match in the same
          voice as a 0.99 one — on a fresh eval set most of the wrong answers
          arrived below 0.5, and every one of them looked, on the page, exactly
          like a confident ruling. */}
      {matched && !confident && (
        <p
          className="rounded-md border px-3 py-2 text-xs leading-5"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-raised)",
            color: "var(--text-muted)",
          }}
        >
          <strong className="font-semibold">
            This may not be the question you asked.
          </strong>{" "}
          Nothing in the bank matched closely, and this was the nearest. Check
          that it is about your question before relying on it
          {alternatives.length > 0 ? ", and see the alternatives below" : ""}.
        </p>
      )}

      {matched && alternatives.length > 0 && onAsk && (
        <div
          className="rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-raised)",
            color: "var(--text-muted)",
          }}
        >
          <p className="leading-5">
            {alternatives.length === 1
              ? "This was close to another question we have an answer for. If you meant that one, open it instead:"
              : "This was close to other questions we have answers for. If you meant one of these, open it instead:"}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {alternatives.map((a) => (
              <li key={a.slug}>
                <button
                  type="button"
                  onClick={() => onAsk(a.question)}
                  className="rounded border px-2 py-1 text-left text-xs surface-hover"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {a.question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="whitespace-pre-wrap text-[0.9375rem] leading-7">
        <RichText
          text={content}
          renderCite={(ordinal, key) => {
            const citation = byOrdinal.get(ordinal);
            if (!citation) return null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onCite(citation.chunkId)}
                title={citation.canonicalRef}
                aria-label={`Source ${ordinal}: ${citation.canonicalRef}`}
                className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] translate-y-[-0.15rem] items-center
                           justify-center rounded px-1 align-middle text-[0.6875rem] font-semibold
                           surface-hover"
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent-text)",
                }}
              >
                {ordinal}
              </button>
            );
          }}
        />
      </div>

      {/* The guardrail catches references named in prose that carry no citation
          span — the one failure that would most damage trust, so it is shown to
          the reader rather than only logged. */}
      {grounding && grounding.unverified.length > 0 && (
        <p
          className="rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-muted)",
            background: "var(--bg-raised)",
          }}
        >
          <strong className="font-semibold">Unverified reference:</strong>{" "}
          {grounding.unverified.map((u) => u.text).join(", ")} — mentioned in the
          answer but not backed by a retrieved source. Verify before relying on
          it.
        </p>
      )}

      {/* Provenance, stated exactly. The previous fallback here read "Reviewed
          before publication" whenever no reviewer was recorded — which is to
          say, it asserted a human review precisely in the case where there had
          not been one. An answer about divorce or apostasy carrying a false
          claim of scholarly approval is worse than the same answer carrying
          none, so the unreviewed case now says so, and says it where the
          reader cannot miss it rather than in grey type at the foot. */}
      {matched && answer && (
        answer.reviewedBy ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Reviewed by {answer.reviewedBy}
            {answer.reviewedAt
              ? ` on ${new Date(answer.reviewedAt).toLocaleDateString()}`
              : ""}
            .
          </p>
        ) : (
          <p
            className="rounded-md border px-3 py-2 text-xs leading-5"
            style={{
              borderColor: "var(--border)",
              color: "var(--text-muted)",
              background: "var(--bg-raised)",
            }}
          >
            <strong className="font-semibold">
              No scholar has reviewed this answer.
            </strong>{" "}
            It was assembled by software from the classical texts quoted above,
            and every quotation is checked to appear verbatim in the work it is
            attributed to — but the reasoning between the quotations is not
            vouched for by anyone. Read the passages themselves before you act
            on it.
          </p>
        )
      )}

      {content.length > 0 && (
        <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>
          {FATWA_DISCLAIMER}
        </p>
      )}
    </div>
  );
}

/**
 * Shown when no reviewed answer covered the question.
 *
 * Deliberately visually distinct from an answer. The failure mode to avoid is a
 * reader skimming source passages and taking them for a ruling, so this says
 * what it is before they read anything.
 */
export function NoMatchNotice({ note }: { note: string }) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
    >
      <p className="text-sm font-medium">No reviewed answer yet</p>
      <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
        {note}
      </p>
    </div>
  );
}
