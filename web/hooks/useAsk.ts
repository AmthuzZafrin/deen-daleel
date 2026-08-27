"use client";

import { useCallback, useState } from "react";

import type {
  Alternative,
  AnswerMeta,
  ChatMessage,
  Citation,
  Source,
} from "@/lib/types";

/**
 * Asks /api/ask and appends the result.
 *
 * A plain request/response — there is no streaming any more, because there is
 * nothing to stream: the answer already exists, reviewed, in the database. It
 * arrives whole and instantly, which is the correct behaviour for a reference
 * work and replaced a good deal of SSE machinery.
 */

interface AskResponse {
  conversationId: string;
  messageId: string;
  matched: boolean;
  note?: string;
  answer?: AnswerMeta & { body: string };
  citations: Citation[];
  sources: Source[];
  alternatives?: Alternative[];
  confident?: boolean;
}

export function useAsk() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const ask = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || isLoading) return;

      const pendingId = `pending-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: "user", content: question },
        { id: pendingId, role: "assistant", content: "", pending: true },
      ]);
      setIsLoading(true);

      try {
        const resp = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, conversationId }),
        });

        if (!resp.ok) {
          const detail = (await resp.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(detail.error ?? `request failed (${resp.status})`);
        }

        const data = (await resp.json()) as AskResponse;
        setConversationId(data.conversationId);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: data.messageId,
                  role: "assistant",
                  content: data.matched ? data.answer!.body : (data.note ?? ""),
                  matched: data.matched,
                  answer: data.answer,
                  alternatives: data.alternatives ?? [],
                  confident: data.confident ?? true,
                  citations: data.citations,
                  sources: data.sources,
                }
              : m,
          ),
        );
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  ...m,
                  pending: false,
                  error: err instanceof Error ? err.message : String(err),
                }
              : m,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, isLoading],
  );

  const load = useCallback((loaded: ChatMessage[], id: string) => {
    setMessages(loaded);
    setConversationId(id);
  }, []);

  const reset = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  return { messages, isLoading, conversationId, ask, load, reset };
}
