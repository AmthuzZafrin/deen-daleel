-- Deen & Daleel — pinned and shared conversations
--
-- `pinned_at` keeps a conversation at the top of the reader's sidebar; it is a
-- timestamp rather than a flag so pins list most-recent-first.
--
-- `share_token` is what a public link carries. It is minted on first share and
-- is deliberately *not* the conversation id: the id is what the owner's
-- session uses to reach the thread, and a link that anyone can see should be
-- revocable (set it back to null) without renaming the conversation itself.

begin;

alter table conversations
  add column if not exists pinned_at   timestamptz,
  add column if not exists share_token uuid unique;

commit;
