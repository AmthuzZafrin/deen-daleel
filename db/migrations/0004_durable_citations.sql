-- Deen & Daleel — citations that survive re-ingestion
--
-- `answer_citations.chunk_id` pointed at a row that ingestion destroys and
-- recreates: `replace_chunks` deletes a document's chunks and inserts new ones
-- with new ids, so every re-ingest of a source cascaded its citations away.
-- Both demo answers lost all their daleel that way while remaining
-- `status='published'` — an answer still on display, still carrying a reviewer's
-- name, now citing nothing. That is the precise failure the review gate exists
-- to prevent, arriving through the back door.
--
-- The fix is to stop treating the chunk row as the identity of a citation. What
-- the reviewer actually approved was a passage at a printed location: 'Sahih
-- al-Bukhari 3:114', and the words quoted from it. Those are stable across
-- re-chunking; the row id is not.
--
-- So the reference is recorded here, the foreign key becomes advisory, and a
-- rebinding pass re-resolves `chunk_id` after each ingest. A citation whose
-- passage can no longer be found ends up with a null chunk_id and a ref that
-- still says what it was — visibly broken, and reviewable, instead of silently
-- gone.

begin;

alter table answer_citations
  add column if not exists canonical_ref text not null default '';

comment on column answer_citations.canonical_ref is
  'The printed location the reviewer approved, e.g. ''Al-Mughni 3:214''. '
  'Durable identity of the citation; chunk_id is a cache of where that text '
  'currently lives and is re-resolved after ingestion.';

-- Deleting a chunk must orphan the citation, not erase it. Losing the pointer
-- is recoverable; losing the record that a claim was ever backed is not.
alter table answer_citations
  drop constraint if exists answer_citations_chunk_id_fkey;

alter table answer_citations
  alter column chunk_id drop not null;

alter table answer_citations
  add constraint answer_citations_chunk_id_fkey
  foreign key (chunk_id) references chunks(id) on delete set null;

-- Rebinding looks citations up by their reference, so it must not be a scan.
create index if not exists chunks_canonical_ref_idx
  on chunks (canonical_ref) where canonical_ref <> '';

create index if not exists answer_citations_unresolved_idx
  on answer_citations (answer_id) where chunk_id is null;

commit;
