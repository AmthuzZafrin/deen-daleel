"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The message composer.
 *
 * The mic, attach and screenshot buttons are rendered and laid out but not yet
 * wired — v1 ships the citation core first. They live here now so that adding
 * the handlers later touches this file only, rather than reflowing the layout
 * once three controls appear.
 */

interface Props {
  onSend: (text: string) => void;
  isLoading: boolean;
}

const STUBBED = [
  { key: "voice", label: "Voice input", icon: MicIcon },
  { key: "attach", label: "Attach a file or photo", icon: PaperclipIcon },
  { key: "screenshot", label: "Take a screenshot", icon: CameraIcon },
] as const;

export function Composer({ onSend, isLoading }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to a cap, then scroll internally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || isLoading) return;
    onSend(text);
    setValue("");
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <div
        className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border px-3 py-2.5 shadow-sm
                   focus-within:ring-1"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg)",
          ["--tw-ring-color" as string]: "var(--accent)",
        }}
      >
        <div className="flex items-center gap-0.5 pb-1">
          {STUBBED.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              disabled
              title={`${label} — coming soon`}
              aria-label={`${label} (coming soon)`}
              className="rounded-lg p-1.5 opacity-40 transition-opacity"
              style={{ color: "var(--text-muted)" }}
            >
              <Icon />
            </button>
          ))}
        </div>

        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask a question about Islam…"
          className="max-h-[200px] flex-1 resize-none bg-transparent py-1.5 text-[0.9375rem]
                     leading-6 outline-none placeholder:opacity-50"
          aria-label="Your question"
        />

        {/* No stop button: a lookup returns whole in well under a second, so
            there is nothing to interrupt. */}
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || isLoading}
          aria-label="Send"
          className="mb-0.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white
                     transition-opacity disabled:opacity-30"
          style={{ background: "var(--accent)" }}
        >
          {isLoading ? "…" : "Send"}
        </button>
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
