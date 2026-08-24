-- Deen & Daleel — reviewed answer bank
--
-- Answers are drafted offline against retrieved daleel, reviewed by a person,
-- and only then served. Nothing here is generated in the request path: at
-- runtime a question is matched against `answer_questions` and the stored
-- answer is returned as-is.

begin;

-- ---------------------------------------------------------------------------
-- Answers
-- ---------------------------------------------------------------------------

create table answers (
  id           bigserial primary key,
  slug         text unique not null,      -- stable public identifier, e.g. 'fasting-ramadan-obligation'
  question     text not null,             -- the canonical phrasing
  body         text not null,             -- the answer as it will be shown

  -- The review gate. Only 'published' is ever served to a reader; a draft is
  -- invisible to the app no matter how good it looks.
  status       text not null default 'draft'
               check (status in ('draft', 'in_review', 'published', 'rejected')),

  generated_by text,                      -- model id, or 'human' for hand-written answers
  generated_at timestamptz,
  reviewed_by  text,
  reviewed_at  timestamptz,
  review_notes text,
  published_at timestamptz,

  -- Guardrail output from generation time, kept so a reviewer can see which
  -- references the drafting step could not tie to a retrieved source.
  grounding    jsonb not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index answers_status_idx on answers (status);
-- Partial index: the serving path only ever looks at published rows.
create index answers_published_idx on answers (published_at desc) where status = 'published';

-- ---------------------------------------------------------------------------
-- Question phrasings
-- ---------------------------------------------------------------------------

-- One answer, many ways of asking for it. Matching a user's wording against a
-- set of real phrasings is far more reliable than matching it against answer
-- prose or raw scripture, so each phrasing carries its own embedding.
create table answer_questions (
  id         bigserial primary key,
  answer_id  bigint not null references answers(id) on delete cascade,
  text       text not null,
  is_primary boolean not null default false,
  embedding  vector(1024) not null,
  tsv tsvector generated always as (to_tsvector('english', text)) stored,
  created_at timestamptz not null default now()
);

create index answer_questions_answer_idx on answer_questions (answer_id);
create index answer_questions_embedding_idx on answer_questions
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);
create index answer_questions_tsv_idx on answer_questions using gin (tsv);

-- Exactly one primary phrasing per answer.
create unique index answer_questions_one_primary_idx
  on answer_questions (answer_id) where is_primary;

-- ---------------------------------------------------------------------------
-- Citations
-- ---------------------------------------------------------------------------

-- Deliberately the same shape as message_citations, so the existing Answer and
-- SourcePanel components render a stored answer with no changes.
create table answer_citations (
  id         bigserial primary key,
  answer_id  bigint not null references answers(id) on delete cascade,
  chunk_id   bigint not null references chunks(id) on delete cascade,
  ordinal    int    not null,
  cited_text text   not null
);

create index answer_citations_answer_idx on answer_citations (answer_id, ordinal);

-- ---------------------------------------------------------------------------
-- Query log
-- ---------------------------------------------------------------------------

-- Every question asked, matched or not. Unmatched rows are the editorial work
-- queue: they are what people actually wanted and the bank did not cover.
create table query_log (
  id            bigserial primary key,
  query_text    text not null,
  matched       boolean not null,
  top_answer_id bigint references answers(id) on delete set null,
  top_score     real,
  session_id    text,
  created_at    timestamptz not null default now()
);

create index query_log_created_idx on query_log (created_at desc);
-- The misses are read far more often than the hits, and are a small fraction of
-- the table, so they get their own partial index.
create index query_log_unmatched_idx on query_log (created_at desc) where not matched;

-- ---------------------------------------------------------------------------
-- Link a served answer back to the conversation turn
-- ---------------------------------------------------------------------------

alter table messages
  add column answer_id bigint references answers(id) on delete set null;

commit;
