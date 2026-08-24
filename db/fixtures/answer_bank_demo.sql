-- Development fixture: one published answer and one draft, wired to real
-- Qur'an chunks already in the corpus.
--
-- Purpose: exercise the review page and the runtime lookup without an API key.
-- This is NOT seed data for production — the answer bodies are illustrative and
-- have not been reviewed by anyone qualified.
--
-- The `embedding` values are placeholder zero vectors. Offline there is no way
-- to produce a real one, and a random vector would rank by noise. Consequence:
-- the vector arm of matchAnswer cannot find these rows; only the lexical arm
-- can. Regenerate them with the real pipeline before trusting any match scores.
--
--   docker exec -i deen-daleel-db psql -U deen -d deen_daleel \
--     -f - < db/fixtures/answer_bank_demo.sql
--
-- Re-runnable. Remove with:
--   delete from answers where slug like 'fixture-%';

begin;

delete from answers where slug like 'fixture-%';

-- Resolve chunks by canonical ref rather than hardcoding ids, which shift on
-- re-ingest.
create temporary table fx_chunk on commit drop as
  select d.canonical_ref, min(c.id) as chunk_id
    from chunks c
    join documents d on d.id = c.document_id
   where d.canonical_ref in ('Qur''an 2:183', 'Qur''an 2:185')
   group by d.canonical_ref;

-- ---------------------------------------------------------------- published --

with a as (
  insert into answers (slug, question, body, status, generated_by, generated_at,
                       reviewed_by, reviewed_at, published_at, grounding)
  values (
    'fixture-fasting-obligatory',
    'Is fasting in Ramadan obligatory?',
    'Yes. Fasting the month of Ramadan is one of the five pillars of Islam and '
    || 'is obligatory on every adult Muslim who is sane and able to fast. The '
    || E'Qur\'an states it directly: "Fasting is prescribed for you, even as it '
    || 'was prescribed for those before you, that ye may ward off (evil)."'
    || E'\n\n'
    || 'The obligation is tied to the month itself: "And whosoever of you is '
    || 'present, let him fast the month."'
    || E'\n\n'
    || 'Exemptions exist and are part of the ruling, not exceptions to it — the '
    || 'traveller and the ill are told to make up the same number of days later. '
    || 'Whether a particular illness, pregnancy, or occupation exempts you is a '
    || 'question of applying the ruling to your own circumstances, and that is '
    || 'for a scholar who knows them to answer, not for this page.',
    'published',
    'fixture', now(), 'Dev Fixture', now(), now(),
    '{}'::jsonb
  )
  returning id
)
insert into answer_questions (answer_id, text, is_primary, embedding)
select a.id, q.text, q.is_primary, array_fill(0::real, array[1024])::vector
  from a, (values
    ('Is fasting in Ramadan obligatory?', true),
    ('Do I have to fast during Ramadan?', false),
    ('Is fasting fard?', false),
    ('is fasting obligatory', false),
    ('Is Ramadan fasting compulsory for Muslims?', false)
  ) as q(text, is_primary);

insert into answer_citations (answer_id, chunk_id, ordinal, cited_text)
select a.id, f.chunk_id, v.ordinal, v.cited_text
  from answers a
  join (values
    (1, 'Qur''an 2:183', 'Fasting is prescribed for you, even as it was prescribed for those before you, that ye may ward off (evil).'),
    (2, 'Qur''an 2:185', 'And whosoever of you is present, let him fast the month.')
  ) as v(ordinal, ref, cited_text) on true
  join fx_chunk f on f.canonical_ref = v.ref
 where a.slug = 'fixture-fasting-obligatory';

-- -------------------------------------------------------------------- draft --

-- Carries a grounding flag so the review page's "Check carefully" banner has
-- something to render.
with a as (
  insert into answers (slug, question, body, status, generated_by, generated_at, grounding)
  values (
    'fixture-missed-fast-makeup',
    'What do I do if I miss a fast?',
    'A fast missed for a valid reason — illness or travel — is made up day for '
    || 'day after Ramadan ends. A fast broken deliberately without excuse is a '
    || 'more serious matter and carries an expiation, and the scholars differ on '
    || 'its details.'
    || E'\n\n'
    || 'It is reported in Sahih al-Bukhari that the Prophet (peace be upon him) '
    || 'addressed this, though the specific ruling depends on how the fast was '
    || 'broken.',
    'draft', 'fixture', now(),
    '{"unverified": [{"text": "Sahih al-Bukhari", "kind": "hadith"}]}'::jsonb
  )
  returning id
)
insert into answer_questions (answer_id, text, is_primary, embedding)
select a.id, q.text, q.is_primary, array_fill(0::real, array[1024])::vector
  from a, (values
    ('What do I do if I miss a fast?', true),
    ('How do I make up a missed fast?', false),
    ('I broke my fast, what now?', false)
  ) as q(text, is_primary);

insert into answer_citations (answer_id, chunk_id, ordinal, cited_text)
select a.id, f.chunk_id, 1,
       'And whosoever of you is present, let him fast the month.'
  from answers a
  join fx_chunk f on f.canonical_ref = 'Qur''an 2:185'
 where a.slug = 'fixture-missed-fast-makeup';

commit;

select a.slug, a.status,
       (select count(*) from answer_questions q where q.answer_id = a.id) as phrasings,
       (select count(*) from answer_citations c where c.answer_id = a.id) as citations
  from answers a
 where a.slug like 'fixture-%'
 order by a.slug;
