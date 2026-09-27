"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  /** Mobile drawer state. */
  open: boolean;
  onToggle: () => void;
  /** Desktop: the sidebar is hidden entirely and the page takes its width. */
  collapsed: boolean;
  onClose: () => void;
}

const DAY = 86_400_000;

function bucketOf(iso: string): string {
  const age = Date.now() - new Date(iso).getTime();
  if (age < DAY) return "Today";
  if (age < 7 * DAY) return "Previous 7 days";
  if (age < 30 * DAY) return "Previous 30 days";
  return "Older";
}

const ORDER = ["Pinned", "Today", "Previous 7 days", "Previous 30 days", "Older"];

export function Sidebar({
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
  onPin,
  open,
  onToggle,
  collapsed,
  onClose,
}: Props) {
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? conversations.filter((c) => c.title.toLowerCase().includes(needle))
      : conversations;

    const buckets = new Map<string, ConversationSummary[]>();
    for (const c of matching) {
      const bucket = c.pinnedAt ? "Pinned" : bucketOf(c.updatedAt);
      const list = buckets.get(bucket) ?? [];
      list.push(c);
      buckets.set(bucket, list);
    }
    // Most recently pinned first, as the other buckets are most recently used.
    buckets.get("Pinned")?.sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!));
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
                    md:static md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}
                    ${collapsed ? "md:hidden" : ""}`}
        style={{ background: "var(--bg-sunken)", borderColor: "var(--border)" }}
        aria-label="Conversations"
      >
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between pl-1">
            <span className="text-[0.9375rem] font-semibold">Deen &amp; Daleel</span>
            <SidebarToggle onClick={onClose} label="Close sidebar" />
          </div>
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
                  <ConversationRow
                    key={c.id}
                    conversation={c}
                    active={c.id === activeId}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onPin={onPin}
                  />
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

/**
 * One chat in the list, with a "⋯" menu holding its actions.
 *
 * Delete asks once more inside the menu rather than through `window.confirm`:
 * a conversation cannot be recovered, but a native dialog is jarring and blocks
 * the page, and the second click is enough to stop a slip.
 */
function ConversationRow({
  conversation: c,
  active,
  onSelect,
  onDelete,
  onPin,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setMenuOpen(false);
      setConfirming(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function remove() {
    setDeleting(true);
    try {
      await onDelete(c.id);
    } finally {
      setDeleting(false);
      setMenuOpen(false);
      setConfirming(false);
    }
  }

  return (
    <li ref={ref} className="group relative">
      <button
        type="button"
        onClick={() => onSelect(c.id)}
        title={c.title}
        className="surface-hover w-full truncate rounded-lg py-1.5 pl-2 pr-8 text-left text-sm"
        style={
          active
            ? { background: "var(--accent-soft)", color: "var(--accent-text)" }
            : undefined
        }
      >
        {c.pinnedAt && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               className="mr-1.5 inline-block align-[-1px] opacity-60" aria-label="Pinned">
            <path d="M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3z" />
          </svg>
        )}
        {c.title}
      </button>

      <button
        type="button"
        onClick={() => {
          setMenuOpen((v) => !v);
          setConfirming(false);
        }}
        aria-label={`Options for ${c.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center
                    rounded-md surface-hover focus:opacity-100 group-hover:opacity-100
                    ${menuOpen || active ? "opacity-100" : "opacity-100 md:opacity-0"}`}
        style={{ color: active ? "var(--accent-text)" : "var(--text-muted)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-1 top-full z-50 mt-1 w-48 rounded-lg border p-1 text-sm shadow-lg"
          style={{ background: "var(--bg-raised)", borderColor: "var(--border)" }}
        >
          {confirming ? (
            <div className="px-2 py-1.5">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Delete this chat? This can&apos;t be undone.
              </p>
              <div className="mt-2 flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="surface-hover rounded-md px-2 py-1 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="rounded-md px-2 py-1 text-xs font-medium disabled:opacity-50"
                  style={{ background: "var(--danger)", color: "var(--bg)" }}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  await onPin(c.id, !c.pinnedAt);
                }}
                className="surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 17v5M9 3h6l-1 7 4 3v2H6v-2l4-3z" />
                  {c.pinnedAt && <path d="M3 3l18 18" />}
                </svg>
                {c.pinnedAt ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setConfirming(true)}
                className="surface-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                style={{ color: "var(--danger)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                </svg>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** The panel icon ChatGPT and Claude both use for showing and hiding the sidebar. */
export function SidebarToggle({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="surface-hover flex h-8 w-8 items-center justify-center rounded-lg"
      style={{ color: "var(--text-muted)" }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );
}
