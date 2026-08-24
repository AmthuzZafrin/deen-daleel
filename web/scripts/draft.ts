/**
 * Draft answers by hand, against real retrieved daleel, with no API spend.
 *
 *   npx tsx scripts/draft.ts prepare <slug>   # write a worksheet of the daleel
 *   npx tsx scripts/draft.ts commit  <slug>   # store what you wrote, as a draft
 *   npx tsx scripts/draft.ts status           # what is drafted, what is not
 *
 * `generateAnswers.ts` does the same job by calling the Anthropic API. This is
 * the path for writing the answer yourself — or having Claude Code write it in
 * a session — which costs nothing. Both end in the same place: `status='draft'`,
 * invisible to readers until a person publishes it at `/review`.
 *
 * Two steps rather than one, because the retrieval has to happen before the
 * writing. An answer composed without seeing the daleel is the thing this whole
 * application exists to avoid; the worksheet puts the evidence in front of the
 * writer first, and `commit` refuses anything that cites outside it.
 */

import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { pool, query, toVectorLiteral } from "../lib/db";
import { parseCitations, parsePassages, section, words } from "../lib/draftFormat";
import { embedQuery, OFFLINE } from "../lib/rag/embed";
import { checkGrounding } from "../lib/rag/guardrails";
import { retrieve } from "../lib/rag/retrieve";

interface QuestionSpec {
  slug: string;
  question: string;
  paraphrases?: string[];
  expect?: "answer" | "decline";
  note?: string;
  /**
   * Extra queries to retrieve against, so the worksheet is not one-sided.
   *
   * Retrieval returns whichever side of a contested question happens to share
   * vocabulary with how it was asked. "Can I keep my non-Muslim friends"
   * surfaces 4:89 and 9:23 — the verses about not taking allies — and never
   * reaches 60:8, "Allah forbiddeth you not those who warred not against you
   * ... that ye should show them kindness and deal justly with them", which
   * scores 0.955 when asked for in its own words and is the verse the question
   * most needs. Drafting from the retrieved set alone would tell an isolated
   * revert to abandon their friends, on the authority of a search ranking.
   *
   * So the curator names the other side explicitly. This widens what the writer
   * sees; it invents nothing, and `commit` still refuses any quotation that is
   * not really in the passage it claims.
   */
  also_retrieve?: string[];
}

const ROOT = path.resolve(process.cwd(), "..");
const QUESTIONS_PATH = path.join(ROOT, "content", "questions.yaml");
const DRAFT_DIR = path.join(ROOT, "content", "drafts");

function loadQuestions(): QuestionSpec[] {
  return parse(readFileSync(QUESTIONS_PATH, "utf-8")) as QuestionSpec[];
}

function specFor(slug: string): QuestionSpec {
  const spec = loadQuestions().find((q) => q.slug === slug);
  if (!spec) throw new Error(`no question with slug ${slug} in questions.yaml`);
  return spec;
}

const draftPath = (slug: string) => path.join(DRAFT_DIR, `${slug}.md`);

// ---------------------------------------------------------------------------
// prepare
// ---------------------------------------------------------------------------

async function prepare(slug: string) {
  // Under DEEN_OFFLINE the embeddings are deterministic noise, so retrieval
  // returns twelve arbitrary passages. The worksheet would look entirely
  // normal — real references, real chunk ids — and every answer written from it
  // would rest on evidence chosen at random. Refuse, as generateAnswers does.
  if (OFFLINE) {
    throw new Error(
      "DEEN_OFFLINE=1 makes retrieval return arbitrary passages. Start the " +
        "embedding service and unset it before preparing a worksheet.",
    );
  }

  const spec = specFor(slug);
  if (existsSync(draftPath(slug))) {
    throw new Error(
      `${draftPath(slug)} already exists — delete it to re-retrieve, or edit it in place`,
    );
  }

  // The canonical phrasing first: it is the one the runtime matches on, so the
  // writer sees what a reader asking plainly would get. Then any queries the
  // curator added to reach the other side of the question.
  const queries = [spec.question, ...(spec.also_retrieve ?? [])];
  const byId = new Map<number, Awaited<ReturnType<typeof retrieve>>[number]>();
  const from = new Map<number, number>(); // chunk id → which query found it
  for (const [i, q] of queries.entries()) {
    for (const c of await retrieve(q, { topK: queries.length > 1 ? 8 : 12 })) {
      if (!byId.has(c.chunkId)) {
        byId.set(c.chunkId, c);
        from.set(c.chunkId, i);
      }
    }
  }
  const chunks = [...byId.values()];
  if (chunks.length === 0) throw new Error(`retrieval returned nothing for ${slug}`);

  const lines: string[] = [
    `<!-- Worksheet for ${slug}. Fill in the Answer and Citations sections,`,
    `     then: npx tsx scripts/draft.ts commit ${slug}`,
    `     Passages below are the only evidence you may cite. -->`,
    ``,
    `# ${spec.question}`,
    ``,
  ];

  if (spec.expect === "decline") {
    lines.push(
      `> **This question is marked \`expect: decline\`.** The answer must explain`,
      `> why it needs a person — a mufti, a doctor, a lawyer — and must not give`,
      `> a ruling. Cite only to show what the question touches on.`,
      ``,
    );
  }
  if (spec.note) lines.push(`> Reviewer note: ${spec.note}`, ``);

  lines.push(`## Answer`, ``, `<!-- Write here. Mark citations [1], [2] ... -->`, ``);
  lines.push(
    `## Citations`,
    ``,
    `<!-- One per line: N. passage=P quote="exact words from passage P" -->`,
    ``,
  );
  lines.push(`## Passages`, ``);

  chunks.forEach((c, i) => {
    // Name which query surfaced each passage. On a contested question that is
    // the difference between reading a balanced set and reading a search
    // ranking that happened to agree with itself.
    // On its own line, never appended to the `chunk:` line — `parsePassages`
    // anchors on that line ending with the id, and trailing text would silently
    // stop every passage being found.
    const q = from.get(c.chunkId) ?? 0;
    lines.push(
      `### Passage ${i + 1} — ${c.canonicalRef}${c.chapterLevel ? " (chapter-level, no page)" : ""}`,
      ``,
      `- kind: ${c.kind} · source: ${c.sourceTitle} · chunk: ${c.chunkId}`,
      ...(q === 0 ? [] : [`- found via: "${queries[q]}"`]),
      ``,
      "```",
      c.content.trim(),
      "```",
      ``,
    );
  });

  mkdirSync(DRAFT_DIR, { recursive: true });
  writeFileSync(draftPath(slug), lines.join("\n"), "utf-8");
  console.log(`wrote ${path.relative(ROOT, draftPath(slug))} with ${chunks.length} passages`);
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

async function commit(slug: string) {
  const spec = specFor(slug);
  const file = draftPath(slug);
  if (!existsSync(file)) throw new Error(`${file} not found — run prepare first`);
  const body = readFileSync(file, "utf-8");

  const answer = section(body, "Answer");
  if (!answer) throw new Error(`${slug}: the Answer section is empty`);

  // Passage number → chunk id, read back from the worksheet so a citation can
  // only point at evidence that was actually retrieved for this question.
  const passages = new Map(parsePassages(body).map((p) => [p.number, p.chunkId]));
  if (passages.size === 0) throw new Error(`${slug}: no passages found in the worksheet`);

  const citations: { ordinal: number; chunkId: number; citedText: string }[] = [];
  for (const c of parseCitations(section(body, "Citations"))) {
    const chunkId = passages.get(c.passage);
    if (chunkId === undefined) {
      throw new Error(
        `${slug}: citation ${c.ordinal} names passage ${c.passage}, which is not listed`,
      );
    }
    // The parser tolerates a bare `"` inside a quotation, so escaping one is
    // never necessary — and an escape that slips in is stored verbatim and
    // renders as a stray backslash in the daleel. It has happened twice.
    if (c.quote.includes('\\"')) {
      throw new Error(
        `${slug}: citation ${c.ordinal} contains an escaped quote — ` +
          "write the quote character bare; the parser reads to end of line",
      );
    }
    citations.push({ ordinal: c.ordinal, chunkId, citedText: c.quote });
  }

  if (spec.expect !== "decline" && citations.length === 0) {
    throw new Error(`${slug}: no citations — an answer without daleel is not publishable`);
  }

  // Every [N] in the prose must have a citation N behind it, and every citation
  // must be referenced. Neither direction is cosmetic: a marker with no citation
  // is a claim presented as sourced that is not, and an unreferenced citation
  // means the answer was renumbered and a marker now points at the wrong daleel.
  // Both happened while hand-drafting, and the quote check below catches
  // neither — the quotes were all real, just attached to the wrong sentence.
  const marked = new Set(
    [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])),
  );
  const listed = new Set(citations.map((c) => c.ordinal));
  const dangling = [...marked].filter((n) => !listed.has(n)).sort((a, b) => a - b);
  const orphaned = [...listed].filter((n) => !marked.has(n)).sort((a, b) => a - b);
  if (dangling.length > 0) {
    throw new Error(
      `${slug}: the answer marks [${dangling.join("], [")}] with no citation behind it`,
    );
  }
  if (orphaned.length > 0) {
    throw new Error(
      `${slug}: citation${orphaned.length > 1 ? "s" : ""} ${orphaned.join(", ")} ` +
        `${orphaned.length > 1 ? "are" : "is"} never referenced in the answer`,
    );
  }

  // Every quote must really appear in the passage it claims. This is the check
  // that stops a plausible-sounding paraphrase being stored as though it were
  // the source's own words.
  const rows = await query<{ id: string; content: string; ref: string }>(
    `select c.id, c.content,
            coalesce(nullif(c.canonical_ref, ''), d.canonical_ref) as ref
       from chunks c join documents d on d.id = c.document_id
      where c.id = any($1)`,
    [citations.map((c) => c.chunkId)],
  );
  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  for (const c of citations) {
    const row = byId.get(c.chunkId);
    if (!row) throw new Error(`${slug}: citation ${c.ordinal} points at a chunk that no longer exists`);
    if (!words(row.content).includes(words(c.citedText))) {
      throw new Error(
        `${slug}: citation ${c.ordinal} quotes text not found in ${row.ref}:\n  "${c.citedText}"`,
      );
    }
  }

  // Same guardrail the API path runs: an answer naming a source it does not
  // cite is flagged before a reviewer can miss it.
  const grounding = checkGrounding(
    answer,
    citations.map((c) => c.citedText),
    citations.map((c) => byId.get(c.chunkId)!.ref),
  );
  if (grounding.unverified.length > 0) {
    console.log(`\n${slug}: names sources with no citation behind them —`);
    for (const u of grounding.unverified) console.log(`  ${u.kind}: ${u.text}`);
    console.log("  Stored anyway, flagged for the reviewer.\n");
  }

  const phrasings = [spec.question, ...(spec.paraphrases ?? [])];
  const embeddings = await Promise.all(phrasings.map((p) => embedQuery(p)));

  await query("begin");
  try {
    const existing = await query<{ id: string; status: string }>(
      `select id, status from answers where slug = $1`,
      [slug],
    );
    if (existing[0]?.status === "published") {
      throw new Error(`${slug} is published — a rerun must not overwrite approved work`);
    }

    const inserted = await query<{ id: string }>(
      `insert into answers (slug, question, body, status, generated_by,
                            generated_at, grounding)
       values ($1, $2, $3, 'draft', 'claude-code (hand-drafted)', now(), $4)
       on conflict (slug) do update set
         question = excluded.question, body = excluded.body,
         status = 'draft', generated_by = excluded.generated_by,
         generated_at = excluded.generated_at,
         grounding = excluded.grounding,
         updated_at = now()
       returning id`,
      [slug, spec.question, answer, JSON.stringify(grounding)],
    );
    const answerId = Number(inserted[0]!.id);

    await query(`delete from answer_questions where answer_id = $1`, [answerId]);
    await query(`delete from answer_citations where answer_id = $1`, [answerId]);

    for (const [i, phrasing] of phrasings.entries()) {
      await query(
        `insert into answer_questions (answer_id, text, is_primary, embedding)
         values ($1, $2, $3, $4::vector)`,
        [answerId, phrasing, i === 0, toVectorLiteral(embeddings[i]!)],
      );
    }
    for (const c of citations) {
      await query(
        `insert into answer_citations (answer_id, chunk_id, ordinal, cited_text, canonical_ref)
         values ($1, $2, $3, $4, $5)`,
        [answerId, c.chunkId, c.ordinal, c.citedText, byId.get(c.chunkId)!.ref],
      );
    }
    await query("commit");
  } catch (err) {
    await query("rollback");
    throw err;
  }

  console.log(
    `${slug}: stored as draft — ${phrasings.length} phrasings, ${citations.length} citations. Review at /review.`,
  );
}

// ---------------------------------------------------------------------------

async function status() {
  const specs = loadQuestions();
  const rows = await query<{ slug: string; status: string; cites: string }>(
    `select a.slug, a.status, count(ac.id)::text as cites
       from answers a left join answer_citations ac on ac.answer_id = a.id
      group by a.slug, a.status`,
  );
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  let done = 0;
  for (const s of specs) {
    const r = bySlug.get(s.slug);
    if (r) done++;
    const mark = r ? `${r.status} (${r.cites} citations)` : "—";
    console.log(`  ${s.slug.padEnd(34)} ${mark}`);
  }
  console.log(`\n${done}/${specs.length} drafted`);
}

async function main() {
  const [cmd, slug] = process.argv.slice(2);
  try {
    if (cmd === "prepare" && slug) await prepare(slug);
    else if (cmd === "commit" && slug) await commit(slug);
    else if (cmd === "status") await status();
    else {
      console.error("usage: draft.ts prepare <slug> | commit <slug> | status");
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
