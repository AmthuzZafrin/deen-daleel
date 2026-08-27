"use client";

import { useMemo } from "react";

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
 * Citations come back as exact spans of text the model quoted, so rather than
 * asking the model to write `[1]` markers (which it could get wrong, or
 * fabricate), the spans are located in the prose and a marker is inserted at
 * the end of each. The number is therefore always attached to text the API
 * itself vouched for.
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
  /** Ask one of the alternatives instead. */
  onAsk?: (question: string) => void;
}

interface Segment {
  text: string;
  citation?: Citation;
}

/**
 * Split the answer so each cited span ends with its marker.
 *
 * Spans are matched by exact substring — the same text the API reported — and
 * a span that cannot be located is skipped rather than guessed at, so a marker
 * never lands on unrelated prose.
 */
/**
 * Closing punctuation a marker should sit outside of.
 *
 * A cited span usually stops at the last word of the quotation, while the
 * closing quote mark belongs to the sentence around it. Without this, a marker
 * lands between the two and strands the quote — `…ward off (evil). [1] "`.
 */
const CLOSERS = new Set(['"', "'", "”", "’", ")", "]", "»"]);

function segment(content: string, citations: Citation[]): Segment[] {
  if (citations.length === 0) return [{ text: content }];

  const marks: { end: number; citation: Citation }[] = [];
  for (const citation of citations) {
    const needle = citation.citedText.trim();
    if (!needle) continue;
    const at = content.indexOf(needle);
    if (at === -1) continue;

    let end = at + needle.length;
    while (end < content.length && CLOSERS.has(content[end])) end++;

    marks.push({ end, citation });
  }

  if (marks.length === 0) return [{ text: content }];
  marks.sort((a, b) => a.end - b.end);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.end <= cursor) continue;
    segments.push({
      text: content.slice(cursor, mark.end),
      citation: mark.citation,
    });
    cursor = mark.end;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor) });
  return segments;
}

/** Minimal inline formatting. Deliberately not a full markdown engine. */
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

export function Answer({
  content,
  citations = [],
  grounding,
  onCite,
  matched = true,
  answer,
  alternatives = [],
  onAsk,
}: Props) {
  const segments = useMemo(
    () => segment(content, citations),
    [content, citations],
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
      {matched && alternatives.length > 0 && onAsk && (
        <div
          className="rounded-md border px-3 py-2 text-xs"
          style={{
            borderColor: "var(--border)",
            background: "var(--bg-subtle)",
            color: "var(--text-muted)",
          }}
        >
          <p className="leading-5">
            This was close to {alternatives.length === 1 ? "another" : "other"}{" "}
            question we have{alternatives.length === 1 ? "" : "s"} an answer
            for. If you meant one of these, open it instead:
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {alternatives.map((a) => (
              <li key={a.slug}>
                <button
                  type="button"
                  onClick={() => onAsk(a.question)}
                  className="rounded border px-2 py-1 text-left text-xs transition-colors hover:brightness-95"
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
        {segments.map((seg, i) => (
          <span key={i}>
            {renderInline(seg.text, `s${i}`)}
            {seg.citation && (
              <button
                type="button"
                onClick={() => onCite(seg.citation!.chunkId)}
                title={seg.citation.canonicalRef}
                aria-label={`Source ${seg.citation.ordinal}: ${seg.citation.canonicalRef}`}
                className="mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] translate-y-[-0.15rem] items-center
                           justify-center rounded px-1 align-middle text-[0.6875rem] font-semibold
                           transition-colors hover:brightness-110"
                style={{
                  background: "var(--accent-soft)",
                  color: "var(--accent)",
                }}
              >
                {seg.citation.ordinal}
              </button>
            )}
          </span>
        ))}
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
            background: "var(--bg-subtle)",
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
              background: "var(--bg-subtle)",
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
      style={{ borderColor: "var(--border)", background: "var(--bg-subtle)" }}
    >
      <p className="text-sm font-medium">No reviewed answer yet</p>
      <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
        {note}
      </p>
    </div>
  );
}
