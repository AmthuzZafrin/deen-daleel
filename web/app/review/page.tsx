"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Citation, Source } from "@/lib/types";

/**
 * The review gate.
 *
 * A drafted answer is invisible to readers until someone approves it here. The
 * page is built around checking, not skimming: every citation is shown with the
 * Arabic and the translation beside the claim it supports, because that is the
 * only way to tell whether an answer is actually grounded in what it cites.
 *
 * Gated on REVIEW_TOKEN — see app/api/review/route.ts and lib/reviewAuth.ts.
 * Reads are gated as well as writes: drafts are unreviewed material and the
 * miss log records what real people asked.
 */

interface Section {
  index: number;
  title: string;
}

interface SectionProgress extends Section {
  total: number;
  published: number;
  rejected: number;
  remaining: number;
}

interface ReviewAnswer {
  id: number;
  slug: string;
  section: Section | null;
  question: string;
  body: string;
  status: string;
  generatedBy: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  grounding: { unverified?: { text: string }[]; uncited?: boolean };
  phrasings: string[];
  citations: Citation[];
  sources: Source[];
}

interface MissStats {
  total: number;
  missed: number;
  missRate: number;
  unmatched: {
    queryText: string;
    count: number;
    bestScore: number | null;
    topAnswerId: number | null;
    topSlug: string | null;
  }[];
}

const STATUSES = ["draft", "published", "rejected", "all"] as const;

/**
 * A near miss scored close enough that an existing answer probably already
 * covers the question — it likely needs another phrasing, not a new answer.
 * Kept just below MATCH_THRESHOLD (0.5) on purpose.
 */
const NEAR_MISS = 0.35;

/**
 * The review token travels in a header on every request.
 *
 * Held in sessionStorage, not localStorage: it is the key to publishing under
 * the reviewer's name, and it should not outlive the browser tab that was
 * actually being used to review.
 */
function reviewHeaders(extra?: Record<string, string>): Record<string, string> {
  const token =
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem("deen_review_token") ?? "");
  return token ? { ...extra, "x-review-token": token } : { ...extra };
}

export default function ReviewPage() {
  const [answers, setAnswers] = useState<ReviewAnswer[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>("draft");
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Record<number, string>>({});
  const [misses, setMisses] = useState<MissStats | null>(null);
  const [showMisses, setShowMisses] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [progress, setProgress] = useState<SectionProgress[]>([]);
  /** null means every section; otherwise the banner number from questions.yaml. */
  const [section, setSection] = useState<number | null>(null);
  /** Index into the filtered list — what the keyboard shortcuts act on. */
  const [cursor, setCursor] = useState(0);

  // The keydown listener is registered once, so it would otherwise close over
  // the first render's values. These refs give it the current ones without
  // tearing the listener down and rebuilding it on every keystroke.
  const visibleRef = useRef<ReviewAnswer[]>([]);
  const cursorRef = useRef(0);
  const editsRef = useRef<Record<number, string>>({});
  const actRef = useRef<
    (id: number, action: "publish" | "reject" | "save", body?: string) => void
  >(() => {});

  const refresh = useCallback(async () => {
    setLoading(true);
    const resp = await fetch(`/api/review?status=${status}`, {
      headers: reviewHeaders(),
    });
    if (resp.status === 401 || resp.status === 503) {
      const detail = (await resp.json().catch(() => ({}))) as { error?: string };
      setLocked(detail.error ?? "Not authorised to review.");
      setAnswers([]);
      setLoading(false);
      return;
    }
    setLocked(null);
    if (resp.ok) {
      const data = (await resp.json()) as {
        answers: ReviewAnswer[];
        counts: Record<string, number>;
        misses: MissStats;
        sectionProgress: SectionProgress[];
      };
      setAnswers(data.answers);
      setCounts(data.counts);
      setMisses(data.misses);
      setProgress(data.sectionProgress ?? []);
    }
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Remembered locally so a reviewer types their name once per session, not
  // once per answer.
  useEffect(() => {
    setReviewer(localStorage.getItem("deen_reviewer") ?? "");
  }, []);

  /**
   * Keyboard review.
   *
   * At 469 answers, reaching for the mouse between each one is most of the
   * time cost. Shortcuts are suppressed while a field has focus, since the
   * body editor is a textarea and `p` must type a letter there rather than
   * publish the answer being edited.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (locked || e.metaKey || e.ctrlKey || e.altKey) return;

      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;

      const current = visibleRef.current[cursorRef.current];

      if (e.key === "j") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, visibleRef.current.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "p" && current) {
        e.preventDefault();
        void actRef.current(current.id, "publish");
      } else if (e.key === "r" && current) {
        e.preventDefault();
        void actRef.current(current.id, "reject");
      } else if (e.key === "s" && current) {
        e.preventDefault();
        const edited = editsRef.current[current.id];
        if (edited !== undefined) void actRef.current(current.id, "save", edited);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  const visible =
    section === null
      ? answers
      : answers.filter((a) => a.section?.index === section);

  // The filtered list shrinks as answers are published, so a cursor left at the
  // old position would point past the end or at an unrelated answer.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, visible.length - 1)));
  }, [visible.length]);

  useEffect(() => {
    visibleRef.current = visible;
    cursorRef.current = cursor;
    editsRef.current = edits;
    actRef.current = act;
  });

  async function act(
    id: number,
    action: "publish" | "reject" | "save",
    body?: string,
  ) {
    // Inline rather than alert(): a modal dialog blocks the page and is a poor
    // fit for a form error the reviewer needs to read next to the field.
    if (action === "publish" && !reviewer.trim()) {
      setNotice((prev) => ({
        ...prev,
        [id]: "Enter your name above before publishing — it is shown to readers.",
      }));
      return;
    }

    setBusy(id);
    setNotice((prev) => ({ ...prev, [id]: "" }));
    localStorage.setItem("deen_reviewer", reviewer);

    try {
      const resp = await fetch("/api/review", {
        method: "POST",
        headers: reviewHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ id, action, reviewedBy: reviewer, body }),
      });
      if (!resp.ok) {
        const detail = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        setNotice((prev) => ({
          ...prev,
          [id]: detail.error ?? `Request failed (${resp.status}).`,
        }));
        return;
      }
      // Drop the local edit so the refreshed server value is what shows.
      setEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refresh();
    } catch (err) {
      setNotice((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBusy(null);
    }
  }

  // Nothing about the queue is shown while locked — not the drafts, not the
  // counts, not the miss log. An unauthorised visitor should learn only that
  // review exists and that they cannot do it.
  if (locked) {
    return (
      <div className="mx-auto max-w-md px-6 py-16">
        <h1 className="text-xl font-semibold">Answer review</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {locked}
        </p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sessionStorage.setItem("deen_review_token", token.trim());
            setToken("");
            void refresh();
          }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Review token"
            aria-label="Review token"
            className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "var(--on-accent)" }}
          >
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">Answer review</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing here is visible to readers until you publish it. Check each
          citation against the claim it supports before approving.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className="rounded-lg border px-3 py-1.5 text-sm capitalize"
              style={
                s === status
                  ? { background: "var(--accent-soft)", color: "var(--accent-text)", borderColor: "var(--accent)" }
                  : { borderColor: "var(--border)" }
              }
            >
              {s}
              {counts[s] !== undefined && ` (${counts[s]})`}
            </button>
          ))}

          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            placeholder="Your name (shown to readers)"
            aria-label="Reviewer name"
            className="ml-auto rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none"
            style={{ borderColor: "var(--border)" }}
          />
        </div>

        {/* Reviewing 469 answers as one list is a wall. Sectioning it turns
            "469 to go" into "section 1: 4 of 21", and makes it possible to
            publish a coherent tranche rather than a scattering. */}
        {progress.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSection(null)}
              className="rounded-md border px-2 py-1 text-xs"
              style={
                section === null
                  ? { background: "var(--accent-soft)", color: "var(--accent-text)", borderColor: "var(--accent)" }
                  : { borderColor: "var(--border)" }
              }
            >
              All sections
            </button>
            {progress.map((p) => {
              const done = p.published + p.rejected;
              return (
                <button
                  key={p.index}
                  type="button"
                  onClick={() => setSection(p.index)}
                  title={`${p.published} published, ${p.rejected} rejected, ${p.remaining} to go`}
                  className="rounded-md border px-2 py-1 text-xs"
                  style={
                    section === p.index
                      ? { background: "var(--accent-soft)", color: "var(--accent-text)", borderColor: "var(--accent)" }
                      : { borderColor: "var(--border)" }
                  }
                >
                  {p.index}. {p.title}{" "}
                  <span style={{ color: "var(--text-muted)" }}>
                    {done}/{p.total}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Keyboard: <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>p</kbd> publish ·{" "}
          <kbd>r</kbd> reject · <kbd>s</kbd> save edit. Ignored while typing.
        </p>
      </header>

      {/* The work queue. Placed above the drafts because it is what should
          decide which answer gets written next. */}
      {misses && misses.total > 0 && (
        <section
          className="mb-8 rounded-xl border p-4"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="text-sm font-semibold">
              Miss rate {(misses.missRate * 100).toFixed(0)}%
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {misses.missed} of {misses.total} questions asked got no reviewed
              answer
            </span>
            {misses.unmatched.length > 0 && (
              <button
                type="button"
                onClick={() => setShowMisses((v) => !v)}
                className="ml-auto text-xs hover:underline"
                style={{ color: "var(--accent-text)" }}
              >
                {showMisses ? "Hide" : `Show ${misses.unmatched.length} unanswered`}
              </button>
            )}
          </div>

          {showMisses && (
            <ul className="mt-3 space-y-1.5">
              {misses.unmatched.map((m) => {
                const near = (m.bestScore ?? 0) >= NEAR_MISS;
                return (
                  <li
                    key={m.queryText}
                    className="flex flex-wrap items-baseline gap-x-3 border-t pt-1.5 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <span className="min-w-0 flex-1">{m.queryText}</span>
                    {m.count > 1 && (
                      <span
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        asked {m.count}&times;
                      </span>
                    )}
                    {near && m.topSlug ? (
                      <span className="text-xs" style={{ color: "var(--accent-text)" }}>
                        near miss ({m.bestScore?.toFixed(2)}) — consider adding
                        this phrasing to {m.topSlug}
                      </span>
                    ) : (
                      <span
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        best {m.bestScore?.toFixed(2) ?? "—"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {loading && <p className="text-sm">Loading…</p>}

      {!loading && visible.length === 0 && (
        <p
          className="rounded-lg border px-4 py-8 text-center text-sm"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {answers.length > 0
            ? `Nothing left with status “${status}” in this section — pick another above.`
            : `Nothing with status “${status}”.`}
        </p>
      )}

      {visible.map((a, i) => {
        const sourceByChunk = new Map(a.sources.map((s) => [s.chunkId, s]));
        const unverified = a.grounding?.unverified ?? [];

        return (
          <article
            key={a.id}
            ref={(el) => {
              // Keep the keyboard cursor in view. Without this, j/k moves a
              // selection the reviewer cannot see once it passes the fold.
              if (i === cursor && el) {
                el.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }
            }}
            onClick={() => setCursor(i)}
            className="mb-8 rounded-xl border p-5"
            style={
              i === cursor
                ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" }
                : { borderColor: "var(--border)" }
            }
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">{a.question}</h2>
                <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                  {a.section ? `${a.section.index}. ${a.section.title} · ` : ""}
                  {a.slug} · {a.status}
                  {a.generatedBy ? ` · drafted by ${a.generatedBy}` : ""}
                  {a.reviewedBy ? ` · reviewed by ${a.reviewedBy}` : ""}
                </p>
              </div>
            </div>

            {/* Surfaced prominently: these are references the answer makes that
                no retrieved source backs, which is the main thing to catch. */}
            {(unverified.length > 0 || a.grounding?.uncited) && (
              <p
                className="mt-3 rounded-md border px-3 py-2 text-xs"
                style={{ borderColor: "var(--accent)", color: "var(--accent-text)" }}
              >
                <strong>Check carefully.</strong>{" "}
                {unverified.length > 0 &&
                  `References with no citation behind them: ${unverified
                    .map((u) => u.text)
                    .join(", ")}. `}
                {a.grounding?.uncited && "This answer cites nothing at all."}
              </p>
            )}

            <textarea
              value={edits[a.id] ?? a.body}
              onChange={(e) =>
                setEdits((prev) => ({ ...prev, [a.id]: e.target.value }))
              }
              rows={12}
              aria-label="Answer body"
              className="mt-4 w-full resize-y rounded-lg border bg-transparent p-3 text-sm leading-6 outline-none"
              style={{ borderColor: "var(--border)" }}
            />

            <details className="mt-3">
              <summary className="cursor-pointer text-xs" style={{ color: "var(--text-muted)" }}>
                {a.phrasings.length} matching phrasings
              </summary>
              <ul className="mt-2 space-y-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                {a.phrasings.map((p, i) => (
                  <li key={i}>· {p}</li>
                ))}
              </ul>
            </details>

            <section className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Citations ({a.citations.length})
              </h3>
              {a.citations.length === 0 && (
                <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  None — this answer is not grounded in any retrieved source.
                </p>
              )}
              <ol className="mt-2 space-y-3">
                {a.citations.map((c) => {
                  const src = sourceByChunk.get(c.chunkId);
                  return (
                    <li
                      key={c.ordinal}
                      className="rounded-lg border p-3"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <p className="text-xs font-semibold" style={{ color: "var(--accent-text)" }}>
                        [{c.ordinal}] {c.canonicalRef}
                      </p>
                      <p className="mt-1 text-sm italic">&ldquo;{c.citedText}&rdquo;</p>
                      {src?.arabicText && (
                        <p className="arabic mt-2" lang="ar" dir="rtl">
                          {src.arabicText}
                        </p>
                      )}
                      {src?.englishText && (
                        <p className="mt-1 text-sm leading-6" style={{ color: "var(--text-muted)" }}>
                          {src.englishText}
                        </p>
                      )}
                      {src?.permalink && (
                        <a
                          href={src.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs hover:underline"
                          style={{ color: "var(--accent-text)" }}
                        >
                          Verify at source &rarr;
                        </a>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => act(a.id, "save", edits[a.id] ?? a.body)}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: "var(--border)" }}
              >
                Save edits
              </button>
              <button
                type="button"
                disabled={busy === a.id || a.status === "published"}
                onClick={() => act(a.id, "publish")}
                className="btn-accent rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40"
              >
                {a.status === "published" ? "Published" : "Approve & publish"}
              </button>
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => act(a.id, "reject")}
                className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                Reject
              </button>
            </div>

            {notice[a.id] && (
              <p
                role="alert"
                className="mt-2 text-sm"
                style={{ color: "var(--accent-text)" }}
              >
                {notice[a.id]}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
