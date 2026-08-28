"use client";

import { useMemo, useState } from "react";

import type { ConversationSummary } from "@/lib/types";

/**
 * Conversation sidebar: new chat, search, and recents grouped by recency.
 *
 * Grouping matters more here than in a general chat app — people return to a
 * question they asked weeks ago about a specific ruling, and a flat list of
 * near-identical titles ("Is it permissible to…") is unsearchable by eye.
 */

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  open: boolean;
  onToggle: () => void;
}

const DAY = 86_400_000;

function bucketOf(iso: string): string {
  const age = Date.now() - new Date(iso).getTime();
  if (age < DAY) return "Today";
  if (age < 7 * DAY) return "Previous 7 days";
  if (age < 30 * DAY) return "Previous 30 days";
  return "Older";
}

const ORDER = ["Today", "Previous 7 days", "Previous 30 days", "Older"];

export function Sidebar({
  conversations,
  activeId,
  onNewChat,
  onSelect,
  open,
  onToggle,
}: Props) {
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? conversations.filter((c) => c.title.toLowerCase().includes(needle))
      : conversations;

    const buckets = new Map<string, ConversationSummary[]>();
    for (const c of matching) {
      const bucket = bucketOf(c.updatedAt);
      const list = buckets.get(bucket) ?? [];
      list.push(c);
      buckets.set(bucket, list);
    }
    return ORDER.filter((b) => buckets.has(b)).map(
      (b) => [b, buckets.get(b)!] as const,
    );
  }, [conversations, filter]);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 md:hidden"
          onClick={onToggle}
          aria-hidden
        />
      )}
      <nav
        className={`fixed z-40 flex h-full w-[260px] flex-col border-r transition-transform
                    md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "var(--bg-sunken)", borderColor: "var(--border)" }}
        aria-label="Conversations"
      >
        <div className="p-3">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium
                       surface-hover"
            style={{ borderColor: "var(--border)", background: "var(--bg-raised)" }}
          >
            <span className="text-base leading-none">+</span> New chat
          </button>

          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="mt-2 w-full rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none
                       placeholder:opacity-50 focus:ring-1"
            style={{
              borderColor: "var(--border)",
              ["--tw-ring-color" as string]: "var(--accent)",
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {grouped.length === 0 && (
            <p
              className="px-2 py-6 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {filter ? "No matching chats." : "Your chats will appear here."}
            </p>
          )}

          {grouped.map(([bucket, items]) => (
            <section key={bucket} className="mb-3">
              <h2
                className="px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {bucket}
              </h2>
              <ul>
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      title={c.title}
                      className="surface-hover w-full truncate rounded-lg px-2 py-1.5 text-left text-sm"
                      style={
                        c.id === activeId
                          ? { background: "var(--accent-soft)", color: "var(--accent-text)" }
                          : undefined
                      }
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer
          className="border-t px-4 py-3 text-[0.6875rem]"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          Deen &amp; Daleel — answers with their evidence.
        </footer>
      </nav>
    </>
  );
}
