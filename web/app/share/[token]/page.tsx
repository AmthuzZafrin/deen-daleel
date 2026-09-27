"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { SourcePanel } from "@/components/chat/SourcePanel";
import { Thread } from "@/components/chat/Thread";
import { citationParagraphs } from "@/lib/answerText";
import type { ChatMessage, CitedIn, Source } from "@/lib/types";

/**
 * A conversation someone shared. Read-only: the thread renders as its owner saw
 * it, sources open in the same panel, but there is no composer and no sidebar --
 * the visitor is shown one way in, which is to ask their own question.
 */
export default function SharedConversation() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "missing" }
    | { status: "ready"; title: string; messages: ChatMessage[] }
  >({ status: "loading" });
  const [openSource, setOpenSource] =
    useState<{ source: Source; cited: CitedIn[] } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const resp = await fetch(`/api/share?token=${encodeURIComponent(token)}`);
      if (!live) return;
      if (!resp.ok) return setState({ status: "missing" });
      const data = (await resp.json()) as { title: string; messages: ChatMessage[] };
      setState({ status: "ready", ...data });
    })();
    return () => {
      live = false;
    };
  }, [token]);

  // Same assembly as the live chat: the passage, with what this answer said about it.
  function openCitation(message: ChatMessage, chunkId: number) {
    const source = (message.sources ?? []).find((s) => s.chunkId === chunkId);
    if (!source) return;
    setOpenSource({
      source,
      cited: (message.citations ?? [])
        .filter((c) => c.chunkId === chunkId)
        .map((c) => ({
          ordinal: c.ordinal,
          quote: c.citedText,
          context: citationParagraphs(message.content, c.ordinal),
        })),
    });
  }

  return (
    <div className="flex h-full">
      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-14 shrink-0 items-center gap-3 border-b px-4"
          style={{ borderColor: "var(--border)" }}
        >
          <Link href="/" className="font-semibold">
            Deen &amp; Daleel
          </Link>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Shared conversation
          </span>
          <Link
            href="/"
            className="btn-accent ml-auto rounded-lg px-3 py-1.5 text-sm font-medium"
          >
            Ask your own question
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto">
          {state.status === "loading" && (
            <p className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Loading…
            </p>
          )}
          {state.status === "missing" && (
            <p className="p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              This link doesn&apos;t lead to a shared conversation. It may have been
              deleted by the person who shared it.
            </p>
          )}
          {state.status === "ready" && (
            <div className="mx-auto max-w-3xl px-4 py-6">
              <h1 className="mb-6 text-xl font-semibold">{state.title}</h1>
              <Thread
                messages={state.messages}
                onCite={openCitation}
                onOpenSource={(source) => setOpenSource({ source, cited: [] })}
              />
            </div>
          )}
        </div>
      </main>

      <SourcePanel
        source={openSource?.source ?? null}
        cited={openSource?.cited ?? []}
        onClose={() => setOpenSource(null)}
      />
    </div>
  );
}
