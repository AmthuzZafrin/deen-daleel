-- Deen & Daleel — page-accurate citations on the chunk
--
-- A `document` is a physical volume, so `documents.canonical_ref` can only ever
-- say "Fath al-Bari vol. 3". The printed page lives one level down: the chunker
-- already derives it from the mARkdown page markers ("Fath al-Bari 3:114", or
-- "3:114-115" where a chunk spans a page turn) and it was being computed,
-- reported, and then thrown away.
--
-- That page number is the whole point of parsing page markers. Without it a
-- citation cannot be physically checked against an edition, which is the
-- promise the app makes. It belongs on the row that retrieval actually returns.
--
-- Empty string, not null, for the Qur'an and anything else whose document ref
-- is already exact — retrieval coalesces to the document's ref in that case.

begin;

alter table chunks add column if not exists canonical_ref text not null default '';

comment on column chunks.canonical_ref is
  'Printed location of this span, e.g. ''Al-Mughni 3:214''. Empty when the '
  'document''s own ref is already exact (the Qur''an), in which case retrieval '
  'falls back to documents.canonical_ref.';

commit;
