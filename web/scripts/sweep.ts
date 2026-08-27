/**
 * Full pre-publication sweep over every stored answer.
 *
 * Re-runs, against the database rather than the markdown drafts, every check
 * that `draft.ts commit` runs at write time, plus the ones only reachable once
 * the whole bank exists. Nothing here is a substitute for a person reading the
 * prose; it is the half of review a machine can be trusted with.
 */
import "dotenv/config";
import { pool, query } from "../lib/db";
import { words } from "../lib/draftFormat";
import { EMBEDDING_DIM } from "../lib/env";

interface Row {
  id: string; slug: string; question: string; body: string; status: string; grounding: string | null;
}

const problems: { slug: string; kind: string; detail: string }[] = [];
/**
 * Words too common across the bank to mean anything in a slug. Not a general
 * stopword list — these are the ones that recur in dozens of slugs here.
 */
const SLUG_STOPWORDS = new Set([
  "what", "when", "where", "which", "does", "with", "from", "have", "that",
  "this", "islam", "islamic", "muslim", "muslims", "allowed", "haram", "halal",
  "should", "must", "need", "about", "there", "into", "before", "after",
  "someone", "something", "still", "many", "much", "make", "makes", "made",
  "will", "would", "count", "counts", "prayer", "pray", "praying",
  "arent", "cant", "cannot", "dont", "isnt", "wont", "past", "long", "kind",
  "area", "purpose", "take", "behind", "work", "necessary", "replace", "over",
  "during", "before", "after", "under", "like", "just", "only", "also", "even",
  "back", "forth", "them", "they", "your", "mine", "ours", "some", "same",
  "other", "another", "every", "each", "more", "most", "less", "least", "than",
  "then", "very", "really", "actually", "explained", "rejected", "missed",
]);

/**
 * Crude suffix stripping, enough to stop "wiping" and "wipe" reading as
 * different words. Not linguistics — the check only needs to tell a genuine
 * vocabulary gap ("najis" nowhere in the phrasings) from a grammatical one.
 */
const PHRASING_GAPS = process.argv.includes("--phrasing-gaps");

function stem(w: string): string {
  return w
    .replace(/(ies)$/, "y")
    .replace(/(ing|ed|es|s)$/, "")
    .replace(/(.)\1$/, "$1")
    .replace(/e$/, "");
}

function flag(slug: string, kind: string, detail: string) {
  problems.push({ slug, kind, detail });
}

async function main() {
  const answers = await query<Row>(
    `select id, slug, question, body, status, grounding from answers order by id`,
  );
  console.log(`answers: ${answers.length}`);
  // pg returns bigint as a string; every id must be narrowed before it is used
  // as a Map key, or every lookup silently misses and the sweep reports a clean
  // bank as a catastrophe.
  const aid = (a: Row) => Number(a.id);

  const cites = await query<{ answer_id: string; ordinal: number; chunk_id: string; cited_text: string }>(
    `select answer_id, ordinal, chunk_id, cited_text from answer_citations order by answer_id, ordinal`,
  );
  console.log(`citations: ${cites.length}`);

  const byAnswer = new Map<number, typeof cites>();
  for (const c of cites) {
    const k = Number(c.answer_id);
    byAnswer.set(k, [...(byAnswer.get(k) ?? []), c] as typeof cites);
  }

  // Chunk text for every cited chunk, in one pass.
  const chunkIds = [...new Set(cites.map((c) => Number(c.chunk_id)))];
  console.log(`distinct chunks cited: ${chunkIds.length}`);
  const chunkText = new Map<number, { content: string; ref: string }>();
  for (let i = 0; i < chunkIds.length; i += 500) {
    const rows = await query<{ id: string; content: string; ref: string }>(
      `select c.id, c.content,
              coalesce(nullif(c.canonical_ref,''), d.canonical_ref) as ref
         from chunks c join documents d on d.id = c.document_id
        where c.id = any($1)`,
      [chunkIds.slice(i, i + 500)],
    );
    for (const r of rows) chunkText.set(Number(r.id), { content: r.content, ref: r.ref });
  }

  // Phrasing embeddings.
  const zero = "[" + new Array(EMBEDDING_DIM).fill(0).join(",") + "]";
  const unembedded = await query<{ answer_id: string; n: string }>(
    `select answer_id, count(*) as n from answer_questions
      where embedding is null or embedding = $1::vector
      group by answer_id`, [zero],
  );
  const unembeddedBy = new Map(unembedded.map((r) => [Number(r.answer_id), Number(r.n)]));

  const phrasingCount = await query<{ answer_id: string; n: string; joined: string }>(
    `select answer_id, count(*) as n, string_agg(text, ' ') as joined
       from answer_questions group by answer_id`,
  );
  const phrasingsBy = new Map(phrasingCount.map((r) => [Number(r.answer_id), Number(r.n)]));
  const phrasingTextBy = new Map(phrasingCount.map((r) => [Number(r.answer_id), r.joined ?? ""]));

  // Allowed: ASCII, Arabic block, Arabic supplement/extended, presentation forms,
  // and the handful of typographic marks the drafts legitimately use.
  const STRAY = /[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u024F\u0300-\u036F\u1E00-\u1EFF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u2000-\u206F\u2010-\u2027\u2030-\u205E\u2190-\u21FF\u2212]/g;

  for (const a of answers) {
    const cs = byAnswer.get(aid(a)) ?? [];

    // 1. daleel present
    const declines = /the corpus does not|no ruling|does not settle|cannot be answered/i.test(a.body);
    if (cs.length === 0) flag(a.slug, "no-citations", "answer has zero citations");

    // 2. marker/citation correspondence, both directions
    const marked = new Set([...a.body.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
    const listed = new Set(cs.map((c) => c.ordinal));
    const dangling = [...marked].filter((n) => !listed.has(n)).sort((x, y) => x - y);
    const orphaned = [...listed].filter((n) => !marked.has(n)).sort((x, y) => x - y);
    if (dangling.length) flag(a.slug, "dangling-marker", `body marks [${dangling.join("],[")}] with no citation`);
    if (orphaned.length) flag(a.slug, "orphan-citation", `citations ${orphaned.join(", ")} never referenced`);

    // 3. contiguous ordinals from 1
    const ords = cs.map((c) => c.ordinal).sort((x, y) => x - y);
    for (let i = 0; i < ords.length; i++) {
      if (ords[i] !== i + 1) { flag(a.slug, "ordinal-gap", `ordinals ${ords.join(",")}`); break; }
    }

    // 4. every quote really in its chunk
    for (const c of cs) {
      const cid = Number(c.chunk_id);
      const chunk = chunkText.get(cid);
      if (!chunk) { flag(a.slug, "chunk-gone", `citation ${c.ordinal} -> chunk ${cid} no longer exists`); continue; }
      if (c.cited_text.includes('\\"')) flag(a.slug, "escaped-quote", `citation ${c.ordinal}`);
      if (!words(chunk.content).includes(words(c.cited_text))) {
        flag(a.slug, "quote-mismatch", `citation ${c.ordinal} (chunk ${cid}, ${chunk.ref}): ${c.cited_text.slice(0, 70)}`);
      }
    }

    // 5. The same words cited twice *from the same chunk* is a real duplicate.
    // The same words from two different chunks is corroboration — a hadith
    // quoted from both al-Nawawi and al-Tirmidhi, say — and the prose usually
    // says so explicitly. Keying on the chunk keeps the check honest.
    const seen = new Map<string, number>();
    for (const c of cs) {
      const k = `${c.chunk_id}::${words(c.cited_text)}`;
      if (seen.has(k)) flag(a.slug, "duplicate-quote", `citations ${seen.get(k)} and ${c.ordinal} quote the same words from chunk ${c.chunk_id}`);
      else seen.set(k, c.ordinal);
    }

    // 6. structure: ## inside a body truncates the parsed answer
    if (/^##\s/m.test(a.body)) flag(a.slug, "heading-in-body", "`##` heading inside the answer body");

    // 7. stray characters
    const strays = [...new Set(a.body.match(STRAY) ?? [])];
    if (strays.length) {
      flag(a.slug, "stray-char", strays.map((s) => `U+${s.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" "));
    }
    // Cyrillic / Greek words hiding in English prose
    const cyr = a.body.match(/[Ѐ-ӿͰ-Ͽ]+/g);
    if (cyr) flag(a.slug, "wrong-script", [...new Set(cyr)].join(" "));

    // 8. embeddings
    const un = unembeddedBy.get(aid(a)) ?? 0;
    if (un > 0) flag(a.slug, "unembedded", `${un} phrasing(s) not embedded — would publish as keyword-only`);
    const np = phrasingsBy.get(aid(a)) ?? 0;
    if (np === 0) flag(a.slug, "no-phrasings", "no question phrasings — unreachable by search");

    // 8b. The answer's own subject word appears in none of its phrasings.
    //
    // Found by eval rather than reasoning: `what-is-qadar` carried three good
    // phrasings and not one of them contained the word *qadar*, so "what is
    // qadar" retrieved Laylat al-Qadr and missed. `deepfakes-and-impersonation`
    // said "deepfake" throughout and scored 0.02 against a query saying
    // "deepfakes" — the reranker treats the plural as a different word.
    //
    // The slug is the cheapest available statement of what an answer is about,
    // so any distinctive word in it that no phrasing carries is a term readers
    // will type and the matcher will not find. Stopwords and the words that
    // appear in half the bank are skipped; they carry no signal either way.
    const slugTerms = a.slug.split("-").filter((w) => w.length > 3 && !SLUG_STOPWORDS.has(w));
    const phrasingStems = new Set(
      (phrasingTextBy.get(aid(a)) ?? "")
        .toLowerCase()
        .replace(/['\u2019]/g, "")
        .split(/[^a-z]+/)
        .filter(Boolean)
        .map(stem),
    );
    const stems = [...phrasingStems];
    const absent = slugTerms.filter((w) => {
      const t = stem(w);
      if (t.length < 3) return false;
      return !stems.some((ps) => ps.includes(t) || (ps.length >= 4 && t.includes(ps)));
    });
    // Advisory rather than a defect: the bank is sound without it, but a
    // reader typing that word will not find the answer. Off by default so the
    // 97 it currently reports do not bury the checks that mean the data is
    // wrong. `--phrasing-gaps` turns it on when doing editorial work.
    if (PHRASING_GAPS && absent.length > 0 && np > 0) {
      flag(a.slug, "slug-term-unsearchable", `no phrasing contains: ${absent.join(", ")}`);
    }

    // 9. substance
    const wc = a.body.trim().split(/\s+/).length;
    if (wc < 150) flag(a.slug, "thin", `${wc} words`);

    // 10. placeholders / drafting scaffolding left behind
    if (/\bTODO\b|\bTKTK\b|\bXXX\b|\[\s*\]|\bLorem ipsum\b/i.test(a.body)) {
      flag(a.slug, "placeholder", "drafting scaffolding left in the body");
    }
    if (declines && cs.length === 0) { /* expected for decline class */ }
  }

  // Cross-answer: duplicate slugs, duplicate primary questions
  const dupSlug = await query<{ slug: string; n: string }>(
    `select slug, count(*) as n from answers group by slug having count(*) > 1`,
  );
  for (const d of dupSlug) flag(d.slug, "duplicate-slug", `${d.n} rows`);

  const dupPhrase = await query<{ text: string; n: string; slugs: string }>(
    `select q.text, count(distinct q.answer_id) as n,
            string_agg(distinct a.slug, ', ') as slugs
       from answer_questions q join answers a on a.id = q.answer_id
      group by q.text having count(distinct q.answer_id) > 1`,
  );
  for (const d of dupPhrase) flag(d.slugs, "shared-phrasing", `"${d.text}" belongs to ${d.n} answers`);

  console.log("\n=== findings ===");
  if (problems.length === 0) console.log("none");
  const byKind = new Map<string, typeof problems>();
  for (const p of problems) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  for (const [kind, ps] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${kind}  (${ps.length})`);
    for (const p of ps.slice(0, 25)) console.log(`  ${p.slug}: ${p.detail}`);
    if (ps.length > 25) console.log(`  ... and ${ps.length - 25} more`);
  }
  console.log(`\ntotal findings: ${problems.length} across ${new Set(problems.map((p) => p.slug)).size} answers`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
