"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ACCEPT, ExtractError, extractText } from "@/lib/input/extract";
import { ocr, type Progress } from "@/lib/input/ocr";
import { captureScreen } from "@/lib/input/screenshot";
import { speechSupported, startDictation } from "@/lib/input/speech";
import { MAX_QUESTION_CHARS } from "@/lib/limits";

/**
 * The message composer.
 *
 * Four ways in, one thing out. Speaking, attaching a photo or PDF, and
 * grabbing a screenshot all end as ordinary text in the box, where the reader
 * reads it and edits it before sending. That is deliberate rather than
 * convenient: recognition mishears and OCR misreads, and this app answers a
 * question by matching it, so a question nobody checked would be answered
 * confidently and wrongly. Nothing is ever sent on the reader's behalf.
 *
 * OCR and PDF reading run entirely in the tab. Dictation is the one exception
 * -- the browser's own speech service handles the audio -- and the mic button
 * says so.
 */

interface Props {
  onSend: (text: string) => void;
  isLoading: boolean;
}

type Notice = { kind: "error" | "info"; text: string } | null;
type Task = { label: string; pct: number | null } | null;

export function Composer({ onSend, isLoading }: Props) {
  const [value, setValue] = useState("");
  const [task, setTask] = useState<Task>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [listening, setListening] = useState(false);
  const [canDictate, setCanDictate] = useState(false);

  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopDictation = useRef<(() => void) | null>(null);
  const dictationBase = useRef("");

  /** Bumped to abandon a running job. Nothing here can truly be aborted --
   *  the screen picker is the browser's, and a Tesseract job in flight has to
   *  finish -- so cancelling means ignoring the result and giving the composer
   *  back. Without it, a picker left open sits on "starting" for ever with
   *  every button disabled behind it. */
  const runToken = useRef(0);

  // Read after an await, when the closure's copy may be several keystrokes old.
  const latest = useRef(value);
  latest.current = value;

  // Feature detection has to wait for the client: deciding on the server
  // would render a button whose enabled state then flips on hydration.
  useEffect(() => setCanDictate(speechSupported()), []);

  // Grow with content up to a cap, then scroll internally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => () => stopDictation.current?.(), []);

  const busy = task !== null;

  const insert = useCallback((text: string) => {
    const previous = latest.current.trim();
    const merged = previous ? `${previous}\n${text}` : text;
    if (merged.length > MAX_QUESTION_CHARS) {
      setValue(merged.slice(0, MAX_QUESTION_CHARS));
      setNotice({
        kind: "info",
        text: `That was longer than ${MAX_QUESTION_CHARS} characters, so it was cut short. Trim it down to the question you want answered.`,
      });
    } else {
      setValue(merged);
    }
    ref.current?.focus();
  }, []);

  const run = useCallback(
    async (work: (onProgress: Progress) => Promise<string>) => {
      if (busy || isLoading) return;
      const token = ++runToken.current;
      const live = () => runToken.current === token;

      setNotice(null);
      setTask({ label: "starting", pct: null });
      try {
        const text = await work((label, pct) => {
          if (live()) setTask({ label, pct });
        });
        if (live()) insert(text);
      } catch (err) {
        if (!live()) return;
        if (err instanceof ExtractError) {
          // An empty message means the reader cancelled. Not an error.
          if (err.message) setNotice({ kind: "error", text: err.message });
        } else {
          // A library fault. Its message means nothing to a reader, so keep it
          // in the console and say the one useful thing instead.
          console.error("[composer]", err);
          setNotice({
            kind: "error",
            text: "Something went wrong reading that. Typing the question works.",
          });
        }
      } finally {
        // Guarded: an abandoned job must not clear the status of whatever the
        // reader started in its place.
        if (live()) setTask(null);
      }
    },
    [busy, insert, isLoading],
  );

  function cancelTask() {
    runToken.current++;
    setTask(null);
  }

  function toggleDictation() {
    if (listening) {
      stopDictation.current?.();
      return;
    }
    setNotice(null);
    dictationBase.current = value.trim();
    setListening(true);
    stopDictation.current = startDictation({
      onTranscript: (text) => {
        const base = dictationBase.current;
        setValue(
          (base ? `${base} ${text}` : text).slice(0, MAX_QUESTION_CHARS),
        );
      },
      onError: (text) => setNotice({ kind: "error", text }),
      onEnd: () => {
        setListening(false);
        stopDictation.current = null;
        ref.current?.focus();
      },
    });
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset first, so choosing the same file twice fires again.
    event.target.value = "";
    if (file) void run((onProgress) => extractText(file, onProgress));
  }

  function submit() {
    const text = value.trim();
    if (!text || isLoading || busy) return;
    stopDictation.current?.();
    onSend(text);
    setValue("");
    setNotice(null);
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <div
        className="composer-shell mx-auto max-w-3xl rounded-2xl border shadow-sm"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-raised)",
        }}
      >
        {(busy || listening || notice) && (
          <Status
            task={task}
            listening={listening}
            notice={notice}
            onCancel={cancelTask}
            onDismiss={() => setNotice(null)}
          />
        )}

        <div className="flex items-end gap-2 px-3 py-2.5">
          <div className="flex items-center gap-0.5 pb-1">
            <IconButton
              label="Voice input"
              hint={
                canDictate
                  ? "Dictate your question — your browser's speech service transcribes it"
                  : "Voice input needs Chrome or Edge"
              }
              active={listening}
              disabled={!canDictate || busy || isLoading}
              onClick={toggleDictation}
            >
              <MicIcon />
            </IconButton>

            <IconButton
              label="Attach a file or photo"
              hint="Read the question out of a photo, a PDF or a text file"
              disabled={busy || isLoading}
              onClick={() => fileRef.current?.click()}
            >
              <PaperclipIcon />
            </IconButton>

            <IconButton
              label="Take a screenshot"
              hint="Capture a window and read the text in it"
              disabled={busy || isLoading}
              onClick={() =>
                void run(async (onProgress) => {
                  onProgress("choose a window or screen to capture", null);
                  return ocr(await captureScreen(), onProgress);
                })
              }
            >
              <CameraIcon />
            </IconButton>

            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={onFileChosen}
            />
          </div>

          <textarea
            ref={ref}
            rows={1}
            value={value}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              listening ? "Listening…" : "Ask a question about Islam…"
            }
            className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem]
                       leading-6 outline-none placeholder:opacity-50"
            aria-label="Your question"
          />

          {/* No stop button: a lookup returns whole in well under a second, so
              there is nothing to interrupt. */}
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim() || isLoading || busy}
            aria-label="Send"
            className="btn-accent mb-0.5 rounded-lg px-3 py-1.5 text-sm font-medium
                       disabled:opacity-30"
          >
            {isLoading ? "…" : "Send"}
          </button>
        </div>
      </div>

      <p
        className="mx-auto mt-2 max-w-3xl text-center text-[0.6875rem]"
        style={{ color: "var(--text-muted)" }}
      >
        Deen &amp; Daleel is a research aid, not a fatwa service. Rulings for
        your situation should come from a qualified scholar.
      </p>
    </div>
  );
}

function Status({
  task,
  listening,
  notice,
  onCancel,
  onDismiss,
}: {
  task: Task;
  listening: boolean;
  notice: Notice;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="border-b px-3 py-2 text-xs"
      style={{ borderColor: "var(--border)" }}
      role="status"
      aria-live="polite"
    >
      {listening && (
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 animate-pulse rounded-full"
            style={{ background: "var(--danger)" }}
          />
          <span>Listening — speak your question, then press the mic again.</span>
        </span>
      )}

      {task && (
        <span className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <span>
            {task.label}
            {task.pct !== null && ` — ${Math.round(task.pct * 100)}%`}
          </span>
          <span
            className="h-1 flex-1 overflow-hidden rounded-full"
            style={{ background: "var(--bg-sunken)" }}
          >
            <span
              className="block h-full transition-[width]"
              style={{
                width: `${Math.round((task.pct ?? 0.05) * 100)}%`,
                background: "var(--accent)",
              }}
            />
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 underline underline-offset-2"
          >
            cancel
          </button>
        </span>
      )}

      {notice && (
        <span
          className="flex items-start gap-2"
          style={{ color: notice.kind === "error" ? "var(--danger)" : "var(--text-muted)" }}
        >
          <span className="flex-1">{notice.text}</span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 underline underline-offset-2"
          >
            dismiss
          </button>
        </span>
      )}
    </div>
  );
}

function IconButton({
  label,
  hint,
  active = false,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  active?: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      aria-label={label}
      aria-pressed={active}
      className="rounded-lg p-1.5 transition-opacity hover:opacity-100 disabled:opacity-30"
      style={{
        color: active ? "var(--danger)" : "var(--text-muted)",
        opacity: active ? 1 : 0.65,
      }}
    >
      {children}
    </button>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 1 1 5.18 5.18l-9.2 9.19a1.83 1.83 0 1 1-2.59-2.59l8.49-8.48" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}
