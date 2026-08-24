"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Answer, NoMatchNotice } from "@/components/chat/Answer";
import { Composer } from "@/components/chat/Composer";
import { SourcePanel } from "@/components/chat/SourcePanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAsk } from "@/hooks/useAsk";
import type { ChatMessage, ConversationSummary, Source } from "@/lib/types";

const EXAMPLES = [
  "Is fasting during Ramadan obligatory, and who is excused?",
  "What does the Qur'an say about being patient in hardship?",
  "How should I pray if I can't stand?",
  "What is required for a valid wudu?",
];

export function ChatView() {
  const { messages, isLoading, conversationId, ask, load, reset } = useAsk();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    const resp = await fetch("/api/conversations");
    if (!resp.ok) return;
    const data = (await resp.json()) as { conversations: ConversationSummary[] };
    setConversations(data.conversations);
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  // A finished turn is what changes the sidebar (new title, new ordering).
  useEffect(() => {
    if (!isLoading && messages.length > 0) void refreshConversations();
  }, [isLoading, messages.length, refreshConversations]);

  useEffect(() => {
    if (conversationId) setActiveId(conversationId);
  }, [conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const visible = messages;

  const sourcesByChunk = useMemo(() => {
    const map = new Map<number, Source>();
    for (const m of visible) {
      for (const s of m.sources ?? []) map.set(s.chunkId, s);
    }
    return map;
  }, [visible]);

  const openCitation = useCallback(
    (chunkId: number) => {
      const source = sourcesByChunk.get(chunkId);
      if (source) setOpenSource(source);
    },
    [sourcesByChunk],
  );

  async function selectConversation(id: string) {
    setSidebarOpen(false);
    const resp = await fetch(`/api/conversations?id=${id}`);
    if (!resp.ok) return;
    const data = (await resp.json()) as { messages: ChatMessage[] };
    load(data.messages, id);
    setActiveId(id);
  }

  function newChat() {
    reset();
    setActiveId(null);
    setOpenSource(null);
    setSidebarOpen(false);
  }

  const empty = visible.length === 0;

  return (
    <div className="flex h-full">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onNewChat={newChat}
        onSelect={selectConversation}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center gap-3 border-b px-4 py-3 md:hidden"
          style={{ borderColor: "var(--border)" }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle conversations"
            className="rounded p-1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <span className="font-semibold">Deen &amp; Daleel</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          {empty ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
              <h1 className="text-2xl font-semibold">Deen &amp; Daleel</h1>
              <p
                className="mt-2 max-w-md text-sm leading-6"
                style={{ color: "var(--text-muted)" }}
              >
                Ask a question in plain language and get an answer with its
                daleel — the Qur&apos;an, hadith and scholarship it rests on,
                cited so you can read the source yourself.
              </p>
              <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void ask(example)}
                    className="rounded-xl border px-4 py-3 text-left text-sm leading-6 transition-colors hover:brightness-95"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--bg-subtle)",
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6">
              {visible.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="mb-6 flex justify-end">
                    <div
                      className="max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.9375rem] leading-6"
                      style={{ background: "var(--bg-subtle)" }}
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
                            onCite={openCitation}
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
                                      onClick={() => setOpenSource(s)}
                                      className="rounded border px-2 py-1 text-xs transition-colors hover:brightness-95"
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
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <Composer onSend={ask} isLoading={isLoading} />
      </main>

      <SourcePanel source={openSource} onClose={() => setOpenSource(null)} />
    </div>
  );
}
