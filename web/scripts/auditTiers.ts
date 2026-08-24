/**
 * Check each question's `tier` against what the corpus actually returns.
 *
 *   npx tsx scripts/auditTiers.ts            # every question
 *   npx tsx scripts/auditTiers.ts --from 200 # resume partway
 *
 * A tier is a claim about the evidence — A means the sources address the
 * question directly, B that they give only the principle, C that there is
 * nothing citable. Those claims were made by hand before anyone looked. This
 * looks.
 *
 * The measure is deliberately crude, because the precise one does not exist:
 * rerank scores for an English question against Arabic prose run an order of
 * magnitude below the same question against the English Qur'an, so a raw
 * threshold would mark every fiqh question as unsupported. What it reports
 * instead is the shape of the evidence — how strong the best match is, and how
 * many sources of each kind came back — and flags only where that shape
 * disagrees loudly with the hand-written tier.
 *
 * The output is a proposal, not a verdict. Every flagged row is for a person to
 * confirm.
 */

import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

import { pool } from "../lib/db";
import { retrieve } from "../lib/rag/retrieve";

interface Spec {
  slug: string;
  question: string;
  tier?: string;
  expect?: string;
}

const QUESTIONS = path.resolve(process.cwd(), "..", "content", "questions.yaml");

/**
 * Two measures that do *not* work, recorded so they are not tried again:
 *
 *   * **Absolute rerank score.** `what-is-najis` scores 0.0094 and returns
 *     Al-Mughni 1:413 and Al-Fatawa al-Hindiyya 1:46 — both the kitab al-tahara
 *     chapters, exactly right. English queries against Arabic prose score an
 *     order of magnitude below the same query against the English Qur'an, so a
 *     low score means "the passage is Arabic", not "the passage is wrong".
 *   * **Kind mix.** 457 of 469 questions return four or more Qur'an chunks —
 *     because `KIND_FLOOR` in retrieve.ts guarantees it. The balancing that
 *     stops hadith being crowded out also makes the mix uninformative.
 *
 * What does discriminate is the *first* result: a practical fiqh question whose
 * top hit is a tafsir or a verse, rather than a fiqh or hadith work, has
 * usually missed the chapter that answers it. That is a hint for a human, not a
 * verdict — so this records the top reference and leaves the judgement open.
 *
 * Relative movement is trustworthy even though the absolute number is not: if
 * adding a glossary entry lifts a question from 0.005 to 0.05 and changes its
 * top hit from Tabari to Al-Mabsut's chapter on wiping, that is real.
 */
const STRONG = 0.15;

/**
 * Tafsir works that are really works of fiqh, and must not count as a miss.
 *
 * Both Ahkam al-Qur'an are legal commentaries — al-Jassas is a Hanafi jurist
 * arguing rulings verse by verse — and Qurtubi's title is literally "the
 * compendium of the *rulings* of the Qur'an". A practical question that lands
 * on al-Jassas's discussion of the wudu verse has found the chapter that
 * answers it, not fallen back to scripture. The first run flagged
 * `nail-polish-and-wudu` for exactly that, wrongly.
 */
const LEGAL_TAFSIR = new Set(["ahkam-jassas", "ahkam-ibn-arabi", "qurtubi"]);

/**
 * Sections where scripture at the top is the right answer, not a miss.
 *
 * The scripture-top signal assumes a practical question: "how long can I wipe
 * over socks" landing on Tabari has missed the masah chapter. That assumption
 * inverts for creed. "What does tawhid mean", "what happens when we die" and
 * "what is the purpose of life" are questions the Qur'an answers *directly*,
 * and a fiqh work at the top would be the surprising result. Running the audit
 * over section 12 without this exclusion would flag all 29 of its questions and
 * teach the reader to ignore the column.
 *
 * Kept deliberately narrow — three sections whose subject matter simply is
 * scripture and creed. Everything else stays practical enough that a verse at
 * the top is worth a second look.
 */
const SCRIPTURE_SECTIONS = new Set([
  "11", // Qur'an
  "12", // Belief and aqidah
  "24", // Hard questions and doubts
]);

/**
 * Section numbers keyed by slug.
 *
 * The sections are comments in `questions.yaml` (`# 12. Belief and aqidah`), so
 * `parse()` drops them. Read from the raw text instead, in file order.
 */
function sectionsBySlug(raw: string): Map<string, string> {
  const bySlug = new Map<string, string>();
  let current = "";
  for (const line of raw.split("\n")) {
    const header = line.match(/^#\s*(\d+)\.\s/);
    if (header) {
      current = header[1]!;
      continue;
    }
    const slug = line.match(/^-\s*slug:\s*(\S+)/);
    if (slug) bySlug.set(slug[1]!, current);
  }
  return bySlug;
}

async function main() {
  const fromArg = process.argv.indexOf("--from");
  const from = fromArg === -1 ? 0 : Number(process.argv[fromArg + 1] ?? 0);

  const raw = readFileSync(QUESTIONS, "utf-8");
  const specs = parse(raw) as Spec[];
  const section = sectionsBySlug(raw);
  console.log("slug\tsection\tdeclared\ttop\ttopKind\ttopRef\tflag");

  for (const [i, spec] of specs.entries()) {
    if (i < from) continue;
    const declared = spec.expect === "decline" ? "C" : (spec.tier ?? "A");

    let top = 0;
    let topRef = "";
    let topKind = "";
    let topSource = "";
    // The embedding service returned a 500 once during a full run and the row
    // was lost. One retry is enough; a second failure is worth seeing.
    let chunks: Awaited<ReturnType<typeof retrieve>> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        chunks = await retrieve(spec.question, { topK: 12 });
        break;
      } catch (err) {
        if (attempt === 1) {
          console.log(
            `${spec.slug}\t${declared}\tERROR\t\t\t${String(err).slice(0, 60)}`,
          );
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (chunks.length === 0) continue;

    const best = chunks.reduce((a, b) =>
      (b.rerankScore ?? 0) > (a.rerankScore ?? 0) ? b : a,
    );
    top = best.rerankScore ?? 0;
    topRef = best.canonicalRef;
    topKind = best.kind;
    topSource = best.sourceId;


    // A practical question whose best hit is scripture or tafsir, rather than a
    // fiqh or hadith work, has probably missed the chapter that answers it.
    // Flagged for a person to look at, not reclassified automatically.
    const scriptureTop =
      topKind === "quran" ||
      (topKind === "tafsir" && !LEGAL_TAFSIR.has(topSource));
    const sec = section.get(spec.slug) ?? "";
    // A creed question answered from the Qur'an has found what it needed.
    const wantsScripture = SCRIPTURE_SECTIONS.has(sec);
    const flag =
      declared !== "C" && !wantsScripture && scriptureTop && top < STRONG
        ? "CHECK"
        : "ok";

    console.log(
      `${spec.slug}\t${sec}\t${declared}\t${top.toFixed(4)}\t${topKind}\t${topRef}\t${flag}`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
