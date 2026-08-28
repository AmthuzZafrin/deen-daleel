-- Deen & Daleel — published English for the hadith inside a passage
--
-- English existed for the Qur'an alone: 6,236 chunks of 140,379, and 158 of the
-- 2,134 passages the answer bank cites. For hadith, tafsir and fiqh the source
-- panel had nothing to show a reader who cannot read Arabic.
--
-- Machine translation was tested against real cited chunks and rejected:
-- opus-mt-ar-en turned rak'a into "knees", Abu Hurayra into "Father Herrera",
-- and inverted a ruling in Al-Mabsut from "he does not eat it" to "he eats it".
-- A reader who cannot read the Arabic cannot tell which parts are wrong, and
-- the wrong parts are the religiously consequential ones.
--
-- What this table holds instead is a *published human translation*, tied to a
-- chunk only where the translated Arabic was found verbatim inside that chunk.
-- The pairing is therefore checkable in the same way the daleel itself is: the
-- Arabic that was translated is on the page, and `matched_arabic` records
-- exactly which words were located. Nothing here is generated.
--
-- One chunk may carry several rows. A printed page of Sunan al-Tirmidhi holds
-- more than one hadith, and a page of Fath al-Bari quotes the matn it is
-- commenting on -- so a commentary can show English for the hadith it discusses
-- while the commentary around it stays untranslated. `char_offset` keeps them
-- in the order they appear on the page.

begin;

create table if not exists chunk_translations (
  id            bigserial primary key,
  chunk_id      bigint not null references chunks(id) on delete cascade,

  -- Provenance, so the panel can name the translation rather than assert it.
  edition       text   not null,          -- 'eng-bukhari'
  collection    text   not null,          -- 'Sahih al-Bukhari'
  hadith_number integer not null,

  -- The translated Arabic as the translation's own edition prints it, and the
  -- English that belongs to it. Both are stored so a reader -- or a reviewer --
  -- can compare them without leaving the page.
  arabic_text   text   not null,
  english_text  text   not null,

  -- The evidence for the pairing: the normalised Arabic actually found in the
  -- chunk, and what fraction of the hadith that run covers. A row is only
  -- written above a threshold; the number is kept so the bar can be raised
  -- later without re-running the match.
  matched_arabic text  not null,
  coverage      real   not null check (coverage > 0 and coverage <= 1),

  -- Where the match starts in the chunk's normalised Arabic, for ordering.
  char_offset   integer not null,

  created_at    timestamptz not null default now(),

  unique (chunk_id, edition, hadith_number)
);

create index if not exists chunk_translations_chunk_idx
  on chunk_translations (chunk_id, char_offset);

comment on table chunk_translations is
  'Published English for hadith found verbatim inside a chunk. Never machine '
  'translated -- see 0005 header. Rebuilt by ingest/pipelines/hadith_english.py.';

comment on column chunk_translations.coverage is
  'Fraction of the hadith''s word 8-grams located in this chunk. 1.0 means the '
  'whole hadith is present; lower values mean the page carries part of it.';

commit;
