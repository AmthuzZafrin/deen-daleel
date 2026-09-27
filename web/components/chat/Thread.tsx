"use client";

import { Answer, NoMatchNotice } from "@/components/chat/Answer";
import type { ChatMessage, Source } from "@/lib/types";

/**
 * The turns of a conversation: the reader's questions and what came back.
 *
 * Rendered by the live chat and by a shared link alike, so a conversation
 * someone was sent looks exactly like the one its owner had. `onAsk` is
 * optional because a shared page is read-only -- without it the "did you
 * mean" alternatives are not offered as buttons.
 */
export function Thread({
  messages,
  onAsk,
  onCite,
  onOpenSource,
}: {
  messages: ChatMessage[];
  onAsk?: (question: string) => void;
  onCite: (message: ChatMessage, chunkId: number) => void;
  onOpenSource: (source: Source) => void;
}) {
  return (
    <>
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="mb-6 flex justify-end">
            <div
              className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-6"
              style={{ background: "var(--bg-raised)" }}
            >
              {message.content}
            </div>
          </div>
        ) : (
          <div key={message.id} className="mb-8">
            {message.pending ? (
              <p
                className="animate-pulse text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                Searching the sources…
              </p>
            ) : message.error ? (
              <p
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text-muted)",
                }}
              >
                {message.error}
              </p>
            ) : (
              <>
                {message.matched === false ? (
                  <NoMatchNotice note={message.content} />
                ) : (
                  <Answer
                    content={message.content}
                    citations={message.citations}
                    grounding={message.grounding}
                    sources={message.sources}
                    matched={message.matched}
                    answer={message.answer}
                    alternatives={message.alternatives}
                    confident={message.confident}
                    onAsk={onAsk}
                    onCite={(chunkId) => onCite(message, chunkId)}
                  />
                )}

                {(message.sources?.length ?? 0) > 0 && (
                    <details className="mt-3">
                      <summary
                        className="cursor-pointer text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {message.matched === false
                          ? `${message.sources!.length} possibly relevant passages`
                          : `${message.sources!.length} sources consulted`}
                      </summary>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {message.sources!.map((s) => (
                          <li key={s.chunkId}>
                            <button
                              type="button"
                              onClick={() => onOpenSource(s)}
                              className="rounded border px-2 py-1 text-xs surface-hover"
                              style={{ borderColor: "var(--border)" }}
                            >
                              {s.canonicalRef}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
              </>
            )}
          </div>
        ),
      )}
    </>
  );
}
