/

## Nothing reaches a reader unreviewed

**No answer is generated while a user waits.** Answers are drafted offline in
batch, a human approves each one, and only then can it be served. At runtime a
question is matched against the questions attached to *published* answers, and
the stored answer is returned with its citations. The request path makes no
Anthropic API call at all.

```
OFFLINE (batch, human-gated)          RUNTIME (no model call)
  content/questions.yaml                user question
        ↓                                     ↓
  retrieve() → daleel chunks            embed + lexical → RRF → rerank
        ↓                                     ↓
  Claude → draft + citations            ≥ threshold → stored answer + passages
        ↓                               <  threshold → passages + "not covered yet"
  answers (status='draft')                          ↓
        ↓                                     query_log (the work queue)
  human review → 'published'
```

The trade-off is stated plainly: coverage is bounded by how many answers have
been written and reviewed. A question outside the bank gets relevant source
passages and an honest "no reviewed answer yet" rather than a fluent guess. The
miss rate on `/review` is what turns that limit into a work queue.

## Why the citations are trustworthy

During drafting, retrieved passages are passed to Claude as `search_result`
content blocks with `citations: {enabled: true}`. The API returns character-level
spans pointing back into the exact text we supplied, so **the model cannot cite a
hadith that was not retrieved** — a citation naming a chunk that was never sent
is dropped, not guessed at. Citations are not model-authored footnotes; they are
verifiable pointers into the corpus, and a human has checked each one against the
claim it supports before publication.

## Prerequisites

- Docker (engine only — the compose plugin is optional)
- Node.js 20+
- Python 3.10+
- **No API keys.** Embeddings and reranking run locally on BGE-M3; answers are
  drafted offline through Claude Code. A GPU is optional — CPU works and is
  roughly 20x slower, which is fine for queries and slow for a corpus.

Optional, and only if you prefer hosted models: a `VOYAGE_API_KEY` with
`EMBEDDING_BACKEND=voyage`, and an `ANTHROPIC_API_KEY` to use
`scripts/generateAnswers.ts` rather than drafting in-session.

## Getting started

```bash
cp .env.example .env      # defaults are correct; no keys needed

./scripts/db.sh up        # start Postgres 17 + pgvector on localhost:5433
./scripts/db.sh migrate   # apply db/migrations/*.sql

cd ingest                 # ~2.5 GB of torch, plus BGE-M3 on first use
python3 -m venv .venv && .venv/bin/pip install -e . torch sentence-transformers
.venv/bin/python -m serve_embeddings &
```

`scripts/db.sh` uses plain `docker run` so it works without the compose plugin.
If you do have compose, `docker compose up -d` produces an identical container.
`migrate` records what it has applied in `schema_migrations` and skips those, so
it is safe to re-run.

Other commands: `./scripts/db.sh {psql|status|logs|down|reset}`.

There is deliberately no seed fixture. One existed to demonstrate the app before
any answers were written, and it inserted a row with `status='published'` and a
reviewer name — bypassing the gate this whole design rests on. It was removed
once the bank was real. **Nothing should ever write `status='published'` except
a person clicking approve on `/review`.**

## Layout

| Path | What lives there |
|---|---|
| `db/migrations/` | SQL schema, applied in filename order |
| `scripts/` | Database lifecycle helpers |
| `ingest/` | Python: parse → normalise → chunk → embed → Postgres |
| `content/questions.yaml` | The curated question list — the editorial input |
| `web/` | Next.js app: chat UI, `/api/ask`, `/review` |
| `evals/` | Question set and harness for retrieval + citation quality |

## Data model

`sources` (an edition of a work) → `documents` (one ayah / hadith / section) →
`chunks` (one embeddable, retrievable span).

Two details worth knowing:

- **`sources.license` is `NOT NULL`.** An unknown license blocks ingesting that
  source. Qur'an translations, hadith datasets, and modern fatwa material have
  materially different terms, and several widely-mirrored texts are not
  redistributable.
- **`message_citations` persists citation spans.** Without it, reopening an old
  conversation from the sidebar would render an answer whose daleel no longer
  resolves.

The answer bank sits alongside it: `answers` (the reviewed text and its status)
→ `answer_questions` (several phrasings per answer, each independently embedded)
→ `answer_citations` (same shape as `message_citations`, so the UI renders a
stored answer with no component changes). `query_log` records every question
asked, matched or not.

Storing many phrasings per answer is what makes matching work: "can I skip
fasting if I'm ill" and "who is exempt from Ramadan" are the same question and
should reach the same reviewed answer.

## Embeddings

BGE-M3 (`BAAI/bge-m3`, MIT) running locally: 1024 dimensions — matching the
`vector(1024)` column — 100+ languages, 8192-token context. Reranking uses
`bge-reranker-v2-m3`. Neither needs a key, a network, or a quota.

The web app is TypeScript and the model is PyTorch, so `ingest/serve_embeddings.py`
exposes it over HTTP **in Voyage's wire format**. `web/lib/rag/embed.ts` is
therefore unchanged and backend-agnostic — only `VOYAGE_BASE_URL` differs:

```bash
cd ingest && .venv/bin/python -m serve_embeddings   # :8001, /v1/health
```

> **Stop the service before a bulk ingest.** It and `pipelines.classical` each
> load their own copy of BGE-M3, and two will not fit in 6 GB of VRAM — the
> second one dies with a CUDA OOM partway through a book. Checkpoints make that
> recoverable rather than costly, but the run still stops.

Set `EMBEDDING_BACKEND=voyage` to switch back to the hosted API. Both emit 1024
dimensions so no migration is needed — but the corpus **must** be re-embedded,
because vectors from two models are not comparable and mixing them degrades
retrieval silently rather than raising an error. Checkpoints are namespaced by
model name so a stale one cannot be reused across a switch.

**Islamic terms are glossed into the query before it is embedded.** The only
English in the corpus is Pickthall's 1930 translation, which renders *riba* as
"usury", *zakat* as "the poor-due" and *wudu* as "ablution". A reader asks with
the Arabic terms, and nothing bridged the two — the failure was silent and
total, not partial:

```
"what is riba and why is it prohibited"   → 6:145 (0.013), 7:157 (0.003)
"what does the Qur'an say about usury"    → 2:275 (0.985), 30:39 (0.944),
                                             4:161 (0.943), 3:130 (0.941)
```

Those four *are* the verses on riba, sitting in the corpus, and the question as
actually written reached none of them. `lib/rag/glossary.ts` adds the
translation's wording to the query — added, never substituted, since the Arabic
term carries the meaning for the Arabic corpus, which is most of the library.
Applied to the vector and lexical arms and to the reranker, which has the same
vocabulary problem; the Arabic trigram arm gets the original, where the gloss
would only be noise. With it, "how do I perform wudu" returns Qur'an 5:6 —
the wudu verse — at rank 2.

**Arabic is embedded with diacritics folded away.** Measured on BGE-M3, folding
lifts a relevant Arabic query against Qur'an 2:183 from 0.411 to 0.576 cosine
and simultaneously *lowers* an irrelevant one — vocalisation marks carry no
retrieval signal and consume the token budget. So `Chunk.embed_text` holds the
folded projection while `content` stays fully vocalised for display and
citation, and `normalizeQuery()` folds the query to match. Embedding raw
`content` instead is the easy mistake here, and it fails quietly.

## Retrieval

Hybrid: pgvector cosine search (HNSW) and Postgres full-text search, fused with
Reciprocal Rank Fusion, balanced per source kind so voluminous fiqh prose cannot
crowd out the Qur'an and hadith that are the actual evidence, then reranked with
Voyage `rerank-2.5` down to ~12 chunks.

The lexical arm ORs the query's stemmed lexemes rather than using
`plainto_tsquery`, which ANDs them. A natural-language question almost never has
*every* one of its words in the passage that answers it — "establish prayer and
give charity" would match nothing, while the verses that say "establish worship
and pay the poor-due" sit right there. That arm is deliberately high-recall;
fusion and the reranker supply precision.

**Matching a question to an answer** (`lib/rag/answers.ts`) uses the same shape
over `answer_questions` instead of the corpus. Question-to-question comparison is
far more reliable than comparing a question against answer prose or raw
scripture, because the two sides look alike. Every phrasing of every candidate is
reranked and each answer scores as its best-matching one — reranking only the
primary phrasing would throw away the paraphrases that are the whole point of
storing them.

Below `MATCH_THRESHOLD` (default 0.5, tune from `query_log`) nothing is served.
Erring high is deliberate: an honest miss costs a reader nothing, a confidently
wrong answer costs them their trust.

## Ingesting a corpus

```bash
cd ingest
python3 -m venv .venv && .venv/bin/pip install -e .

.venv/bin/python -m pipelines.quran --limit 3 --offline   # pipeline test, no API key
.venv/bin/python -m pipelines.quran                       # full Qur'an, real embeddings
```

`--offline` substitutes deterministic placeholder vectors so the parse → chunk →
load path can be exercised without a key or spend. Retrieval quality with those
vectors is noise by construction; it proves the plumbing, nothing more.

### The classical library

Tafsir, hadith and fiqh come from [OpenITI](https://openiti.org), an academic
corpus of ~7,700 premodern Arabic works. `content/corpus.yaml` is the editorial
record of which works are ingested and under what terms.

```bash
.venv/bin/python -m pipelines.classical --list              # the manifest
.venv/bin/python -m pipelines.classical --book bukhari      # one work
.venv/bin/python -m pipelines.classical --kind hadith       # one kind
.venv/bin/python -m pipelines.classical --limit-chunks 60   # smoke test
```

> **OpenITI is CC BY-NC-SA 4.0** — free, attribution required, **non-commercial
> only**, share-alike. Deen & Daleel is non-commercial by decision, which is what
> makes this corpus usable. Every work carries its licence into
> `sources.license` (NOT NULL) and its credit into `sources.attribution`, which
> must be shown to readers. Monetising this app would mean removing the corpus.

**Page markers are why the format is parsed rather than scraped.** OpenITI
mARkdown carries `PageV01P003` markers, so a chunk cites `Radd al-Muhtar 2:114`
— a location in a printed edition that a reader, or their scholar, can check.
Without them every citation degrades to "somewhere in Radd al-Muhtar", which is
not daleel.

`pipelines.compare_versions` ranks the available digitisations of a work by page
coverage, and picking on that basis has been worth a great deal: Al-Mughni went
from unfetchable to 100%, Bada'i' al-Sana'i from 0% to 99%, Majmu' al-Fatawa from
2% to 98%. Read its percentage as a floor — it counts blocks, while what ships is
chunks, and a chunk needs only one of its blocks to be marked. Use it to rank
versions against each other; take the coverage line from `pipelines.classical`,
which counts chunks, as what a reader will see.

When every version of a work reports "unavailable", suspect the name before the
text. OpenITI's metadata and its GitHub tree disagree more often than expected —
`MughniFiFiqh` vs `Mughni`, `RaddMuhtar` vs `RaddMukhtar`, `ShamsDinQurtubi` vs
`AbuCabdAllahQurtubi`, `JamicSahih` vs `Sunan` — and the repository is
authoritative. Al-Mughni's best version is not in the metadata at all, so the
comparison tool could never have found it.

**Markup that reaches the text is the failure mode with no symptom.** The
pipeline reports success, the citations resolve, the pagination is perfect, and
the reader is shown `ms0262` in the middle of an ayah. `pipelines.audit_text`
looks for it directly: these are Arabic works, so any run of Latin letters or
markup punctuation left in their text is almost certainly something the parser
should have consumed. One pass found ~40,000 artifacts — OpenITI word-count
milestones in 69% of chunks, HTML wrappers making up a quarter of Sunan Abi
Dawud, `### $` hadith markers across 6,329 blocks of Sahih Muslim. The residue
is now 281 in 451,609 blocks, most of it Abu Dawud's publisher colophon, which
is real text from the edition rather than markup. Run it with `--max` after any
parser change so the number cannot drift back up.

Four traps, all of which fail quietly:

- **`PageV00P000` is a placeholder for unpaginated text, not page 0.** Some
  versions carry it for almost the whole book — 4,159 of the Muwatta's 4,575
  markers. Emitting it produces citations reading `Al-Muwatta 0:0`: a
  real-looking reference pointing nowhere, which is worse than admitting the
  page is unknown. It is suppressed, and the pipeline prints page-citation
  coverage per work so a badly paginated version is visible rather than silent.
  Where coverage is poor, look for another version of the same text — they
  differ a lot.
- **The page lives on the chunk, not the document.** A document is one physical
  volume, so `documents.canonical_ref` can only ever say "vol. 3";
  `chunks.canonical_ref` holds the printed page. Every query that renders a
  citation must read them through `REF_COLUMNS` (`web/lib/rag/refs.ts`), which
  prefers the page and falls back to the document for sources whose document ref
  is already exact — an ayah is cited 2:110, not by volume. Where the chunker
  found no page marker at all, the reference is flagged `chapterLevel` and the
  source panel says so, because a reader is entitled to know which citations
  they can actually look up.
- **File variants differ.** `.mARkdownSimple` uses blank lines between
  paragraphs; the full format uses `# ` to open a paragraph and `~~` to continue
  it, and mixes `PageV`/`PageEnd` markers inline, on their own lines, and inside
  headings. All of it is handled, and `tests/test_markdown.py` covers each case,
  because the failure mode is markup appearing in the middle of quoted scripture
  rather than an exception.
- **An inline page marker ends a page for everything before it, not just the
  words beside it.** Majmu' al-Fatawa carries 16,809 inline markers against 45
  standalone ones. Numbering only the fragment next to each inline marker left
  every earlier paragraph waiting for the next *standalone* one, so a chunk drawn
  from that backlog cited `32:135-215` — a span no reader can check. Fixing it
  took block-level pagination across the corpus from 15–40% to 99%, and is why
  `compare_versions` percentages read far lower than what `pipelines.classical`
  reports: the former counts blocks, the latter chunks.

## Writing answers

Two paths to the same place. Both write `status='draft'`, never overwrite a
published answer, and produce something only a person can publish.

**By hand, or in a Claude Code session — no API spend.** This is the path in use.

```bash
cd web
npx tsx scripts/draft.ts prepare fasting-ramadan-obligation  # worksheet of the daleel
#   → content/drafts/<slug>.md, holding the 12 retrieved passages
#   → write the answer and its citations into that file
npx tsx scripts/draft.ts commit  fasting-ramadan-obligation  # store it as a draft
npx tsx scripts/draft.ts status                              # what is done
```

Retrieval happens *before* the writing, deliberately: an answer composed without
seeing the daleel is what this application exists to avoid. `commit` refuses a
citation that points outside the worksheet, and refuses a quote that does not
actually appear in the passage it claims — comparing on words alone, so
punctuation drift is tolerated but invention is not.

**Via the Anthropic API.** `generateAnswers.ts` does the same job by calling
Claude, and is the only place the API is used. It costs money, which is why the
hand path exists.

```bash
npm run generate -- --limit 3
```

Then `npm run dev` and open `/review`: each citation is shown with its Arabic,
translation and permalink next to the claim it supports, and an answer that names
a source with no citation behind it is flagged before you can miss it.

**Run `npx tsx scripts/rebindCitations.ts` after every ingest.** A citation's
identity is the printed location the reviewer approved — `Sahih al-Bukhari
3:114` and the words quoted from it — not the chunk row, which `replace_chunks`
deletes and recreates with a new id each time a source is ingested. The foreign
key used to cascade, so re-ingesting silently stripped published answers of
their daleel and left them on display citing nothing. Now the reference is
stored on `answer_citations`, deletion nulls the pointer instead of erasing the
row, and this script re-resolves it by matching the reference and then the
quotation. Matching ignores case and punctuation, which is where a citation and
its source drift apart without either being wrong. Anything it cannot resolve
uniquely is reported rather than guessed, with published answers named first.

Publishing requires a reviewer name, and that name is shown to readers. An answer
published by nobody in particular is exactly what this design exists to prevent.

Both the page and the API are gated on `REVIEW_TOKEN`, a shared secret checked
in constant time on every request — reads included, since drafts are unreviewed
material and the miss log records what real people asked. The browser holds the
token in `sessionStorage` and sends it as `x-review-token`, so it does not
outlive the tab.

```bash
REVIEW_TOKEN=$(openssl rand -hex 32)   # then set it in the environment
```

> **Unset, it fails closed in production and open on loopback.** A deployed
> instance with no token refuses review entirely, so forgetting to set one takes
> the page down instead of leaving it open; local development keeps working
> without ceremony. One operator and a long random string is the whole design —
> accounts and sessions would be more code to get wrong for no more safety.

## Verifying

```bash
cd ingest
.venv/bin/python -m pytest tests/ -q                   # parser + Arabic normalisation
.venv/bin/python -m pipelines.audit_text --max 500     # markup that reached the text
cd ../web
npm run typecheck
npm run test:offline    # normaliser parity + draft format; needs nothing running
npm test                # the above, plus citations — needs the embedding service
npm run rebind          # after any ingest: re-resolve published citations
DEEN_OFFLINE=1 npx tsx scripts/retrieve.ts "your question"
```

`checkNormalizerParity.ts` (part of `npm test`) is the one to run after touching
either normaliser. The corpus is folded by the Python module and queries by the
TypeScript one; if they drift, Arabic search returns nothing and nothing throws.

**Exercising the full path without API keys.** `VOYAGE_BASE_URL` redirects the
Voyage client, which is also how you would route through a gateway in production.
`scripts/voyageStub.ts` speaks the same wire format, scoring by token overlap:

```bash
npm run stub &
VOYAGE_BASE_URL=http://127.0.0.1:8788 VOYAGE_API_KEY=stub npm run dev
```

It proves plumbing, not quality — its scores say nothing about whether retrieval
is any good. Note `DEEN_OFFLINE=1` is a different thing: it drops the vector arm
entirely and `matchAnswer` then refuses to serve anything, since with no reranker
there is no score to threshold against.

The check that matters most, run with `ANTHROPIC_API_KEY` unset — it must work:

```bash
curl -s localhost:3000/api/ask -H 'content-type: application/json' \
  -d '{"question":"is fasting obligatory"}'
```

## Status

Working end to end, verified in the browser and against the database: schema and
migrations, the full Qur'an (6,236 ayat), hybrid retrieval, the answer bank,
`/api/ask` on both the match and miss paths, the review page with its publish
gate, the chat UI with citation chips and source panel, and the miss-rate view.

Embeddings now run locally on BGE-M3, and retrieval is measured rather than
assumed: "establish prayer and give charity to the poor" returns 2:110, 24:56,
2:277, 22:41 and 2:43, and the Arabic query `هل الصيام واجب` matches an English
answer at 0.999. The classical library ingests from OpenITI with page-accurate
citations.

Not yet done: **review**. All 469 curated questions in `content/questions.yaml`
are drafted — ~395,000 words and 4,986 citations, every quotation mechanically
checked against the passage it claims — and **none are published**, because none
have been read by a reviewer. Until they are, the app retrieves well and answers
nothing. Also outstanding: the eval harness under `evals/`; voice, file upload
and screenshot capture, rendered in the composer but deliberately unwired; and
deployment.

One thing remains unproven: **the live Claude call has never run.** Everything
around it is verified, including citation reconciliation against synthetic API
responses, but no draft has been generated through the API. All 469 were written
in Claude Code instead, which costs nothing extra.
