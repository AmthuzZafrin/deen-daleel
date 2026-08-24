-- Deen & Daleel — initial schema
-- Run against a Postgres 17 instance with the pgvector extension available.

begin;

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Corpus
-- ---------------------------------------------------------------------------

-- A `source` is one edition of one work: a specific Qur'an translation, a
-- specific hadith collection, a specific tafsir. `license` is NOT NULL on
-- purpose — an unknown license is a blocker for ingesting that source, not a
-- detail to sort out later.
create table sources (
  id          text primary key,          -- 'quran-ar-tanzil', 'bukhari-en', 'ibn-kathir-en'
  kind        text not null check (kind in ('quran', 'hadith', 'tafsir', 'fiqh')),
  title       text not null,
  author      text,
  madhhab     text check (madhhab in ('hanafi', 'maliki', 'shafii', 'hanbali')),
  language    text not null,             -- 'ar', 'en', 'ar-en'
  license     text not null,
  attribution text,                      -- required credit line, if the license demands one
  base_url    text,                      -- template for permalinks, e.g. 'https://quran.com/{surah}/{ayah}'
  created_at  timestamptz not null default now()
);

-- A `document` is one addressable unit of a source: one ayah, one hadith, one
-- tafsir segment, one fiqh section. `canonical_ref` is the human-facing
-- citation string and is what the user ultimately sees.
create table documents (
  id            bigserial primary key,
  source_id     text not null references sources(id) on delete cascade,
  canonical_ref text not null,           -- 'Qur''an 2:255', 'Sahih al-Bukhari 1'
  ordinal       int  not null,           -- stable order within the source
  arabic_text   text,
  english_text  text,
  permalink     text,
  metadata      jsonb not null default '{}'::jsonb,  -- surah, ayah, book, chapter, grading, narrator
  created_at    timestamptz not null default now()
);

-- Ingestion is idempotent on this pair: re-running a pipeline upserts rather
-- than duplicating.
create unique index documents_source_ref_uniq on documents (source_id, canonical_ref);
create index documents_source_ordinal_idx on documents (source_id, ordinal);
create index documents_metadata_idx on documents using gin (metadata jsonb_path_ops);

-- A `chunk` is one retrievable + embeddable span. For Qur'an and hadith this is
-- 1:1 with a document (never split a verse or a narration); for tafsir and fiqh
-- a document may produce several.
--
-- source_id/kind are denormalised from documents so the hybrid-search query and
-- its per-kind balancing never need a join.
create table chunks (
  id           bigserial primary key,
  document_id  bigint not null references documents(id) on delete cascade,
  source_id    text   not null references sources(id) on delete cascade,
  kind         text   not null check (kind in ('quran', 'hadith', 'tafsir', 'fiqh')),
  ordinal      int    not null,          -- position within the parent document

  -- What the model actually sees. Always begins with the canonical reference
  -- line, so the model can read what it is looking at even before native
  -- citations resolve.
  content      text not null,

  -- Retrieval-only projections of `content`. Never displayed.
  text_en      text not null default '', -- English portion, feeds the tsvector
  text_ar_norm text not null default '', -- Arabic with tashkeel stripped + letters folded

  embedding    vector(1024) not null,    -- voyage-3-large, default output dim
  token_count  int not null default 0,

  tsv tsvector generated always as (to_tsvector('english', text_en)) stored,

  created_at   timestamptz not null default now()
);

create unique index chunks_document_ordinal_uniq on chunks (document_id, ordinal);

-- Vector half of hybrid search. Cosine distance to match Voyage's normalised
-- embeddings.
create index chunks_embedding_idx on chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Lexical half. This is what catches an exact hadith number or a technical term
-- that the embedding blurs past.
create index chunks_tsv_idx on chunks using gin (tsv);

-- Arabic term lookup (queries containing Arabic words like "wudu" transliterated
-- or the actual script).
create index chunks_ar_trgm_idx on chunks using gin (text_ar_norm gin_trgm_ops);

create index chunks_kind_idx on chunks (kind);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

-- user_id holds the signed anonymous-session id in v1, and a real account id
-- once auth lands. Nullable-free so the ownership check is always a plain
-- equality.
create table conversations (
  id         uuid primary key,
  user_id    text not null,
  title      text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_updated_idx on conversations (user_id, updated_at desc);

create table messages (
  id              uuid primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  -- Retrieval + generation telemetry: retrieved chunk ids, usage, effort,
  -- guardrail flags. Kept loose so we can add fields without a migration.
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index messages_conversation_created_idx on messages (conversation_id, created_at);

-- Persisted native-citation spans. This is what keeps an old conversation's
-- citations clickable after a reload — without it, reopening a chat from the
-- sidebar would show an answer whose daleel no longer resolves.
create table message_citations (
  id         bigserial primary key,
  message_id uuid   not null references messages(id) on delete cascade,
  chunk_id   bigint not null references chunks(id) on delete cascade,
  ordinal    int    not null,            -- the [n] shown in the answer
  cited_text text   not null,            -- exact span the model quoted
  start_char int,
  end_char   int
);

create index message_citations_message_idx on message_citations (message_id, ordinal);

commit;
