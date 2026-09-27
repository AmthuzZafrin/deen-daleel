"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Composer } from "@/components/chat/Composer";
import { SourcePanel } from "@/components/chat/SourcePanel";
import { Thread } from "@/components/chat/Thread";
import { Sidebar, SidebarToggle } from "@/components/layout/Sidebar";
import { useAsk } from "@/hooks/useAsk";
import { citationParagraphs } from "@/lib/answerText";
import type {
  ChatMessage,
  CitedIn,
  ConversationSummary,
  Source,
} from "@/lib/types";

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
  const [openSource, setOpenSource] =
    useState<{ source: Source; cited: CitedIn[] } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
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

  // Remember a collapsed sidebar across reloads. A per-browser convenience, so
  // local storage, and a failure to read it just means the sidebar starts open.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
    } catch {}
  }, []);

  function setSidebarCollapsed(value: boolean) {
    setCollapsed(value);
    try {
      localStorage.setItem("sidebar-collapsed", value ? "1" : "0");
    } catch {}
  }

  const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;

  function closeSidebar() {
    if (isDesktop()) setSidebarCollapsed(true);
    else setSidebarOpen(false);
  }

  function openSidebar() {
    if (isDesktop()) setSidebarCollapsed(false);
    else setSidebarOpen(true);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

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

  /**
   * Open a passage with the answer it was cited from.
   *
   * Keyed on the message rather than the chunk. A thread often asks two
   * related questions whose answers cite the same chunk -- `Al-Minhaj 11:9`
   * turns up in most of the riba bank -- and a chunk-keyed lookup would show
   * the reader both answers' paragraphs about it, one of which they never
   * opened. The handler is built per message so the drawer shows what the
   * answer they clicked in said, and nothing else.
   *
   * Assembled on the client rather than the server because everything it needs
   * is already here: the message content *is* the answer body, markers and all,
   * and its citations carry the ordinal and the quoted span. That also makes a
   * reopened conversation behave identically to a live one -- both rebuild from
   * the same two fields, so neither needs the answer row.
   */
  const openCitation = useCallback(
    (message: ChatMessage, chunkId: number) => {
      const source = (message.sources ?? []).find((s) => s.chunkId === chunkId)
        ?? sourcesByChunk.get(chunkId);
      if (!source) return;
      const cited: CitedIn[] = (message.citations ?? [])
        .filter((c) => c.chunkId === chunkId)
        .map((c) => ({
          ordinal: c.ordinal,
          quote: c.citedText,
          context: citationParagraphs(message.content, c.ordinal),
        }));
      setOpenSource({ source, cited });
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

  async function deleteConversation(id: string) {
    const resp = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!resp.ok) return;
    if (id === activeId) newChat();
    await refreshConversations();
  }

  async function pinConversation(id: string, pinned: boolean) {
    const resp = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (resp.ok) await refreshConversations();
  }

  async function shareConversation() {
    if (!activeId) return;
    const resp = await fetch("/api/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: activeId }),
    });
    if (!resp.ok) {
      setToast({ title: "Couldn't create a link", body: "Please try again." });
      return;
    }
    const { token } = (await resp.json()) as { token: string };
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast({
        title: "Public link copied to your clipboard",
        body: "Anyone with this link can see this conversation.",
      });
    } catch {
      // Clipboard access can be refused; show the link so it can be copied by hand.
      setToast({ title: "Public link created", body: url });
    }
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
        onDelete={deleteConversation}
        onPin={pinConversation}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        collapsed={collapsed}
        onClose={closeSidebar}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="relative flex h-14 shrink-0 items-center gap-2 px-3">
          {/* On a phone the sidebar is a drawer and this is the only way to it;
              on a desktop it shows only once the sidebar has been closed. */}
          <div className={collapsed ? "flex items-center gap-2" : "flex items-center gap-2 md:hidden"}>
            <SidebarToggle onClick={openSidebar} label="Open sidebar" />
            <span className="font-semibold">Deen &amp; Daleel</span>
          </div>

          {activeId && !empty && (
            <button
              type="button"
              onClick={() => void shareConversation()}
              className="surface-hover ml-auto flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
              </svg>
              Share
            </button>
          )}

          {toast && (
            <div
              role="status"
              className="absolute left-1/2 top-2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 gap-3
                         rounded-xl border px-4 py-3 text-sm shadow-lg"
              style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent-text)"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12l3 3 5-6" />
              </svg>
              <div className="min-w-0">
                <p className="font-semibold">{toast.title}</p>
                <p className="break-all" style={{ color: "var(--text-muted)" }}>{toast.body}</p>
              </div>
            </div>
          )}
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
                    className="rounded-xl border px-4 py-3 text-left text-sm leading-6 surface-hover"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--bg-raised)",
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-4 py-6">
              <Thread
                messages={visible}
                onAsk={ask}
                onCite={openCitation}
                onOpenSource={(source) => setOpenSource({ source, cited: [] })}
              />
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <Composer onSend={ask} isLoading={isLoading} />
      </main>

      <SourcePanel
        source={openSource?.source ?? null}
        cited={openSource?.cited ?? []}
        onClose={() => setOpenSource(null)}
      />
    </div>
  );
}
