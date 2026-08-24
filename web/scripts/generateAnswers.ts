/**
 * Draft reference answers offline, for human review.
 *
 * This is the only place Claude is called in the whole system. Nothing it
 * produces reaches a reader: every answer is written with status='draft' and
 * has to be approved by a person first.
 *
 *   npx tsx scripts/generateAnswers.ts --limit 3        # try a few
 *   npx tsx scripts/generateAnswers.ts --slug fasting-ramadan-obligation
 *   npx tsx scripts/generateAnswers.ts                  # everything not yet drafted
 *   npx tsx scripts/generateAnswers.ts --force          # redraft existing drafts
 *
 * Written in TypeScript rather than Python so it reuses `retrieve()` directly —
 * the drafting step must see exactly the same daleel the runtime would, and
 * duplicating retrieval in a second language is how the two silently diverge.
 *
 * Published answers are never overwritten. Once a human has approved something,
 * a rerun of this script must not quietly replace it.
 */

import "dotenv/config";

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Message as AnthropicMessage } from "@anthropic-ai/sdk/resources/messages";
import { parse } from "yaml";

import { EFFORT, MAX_TOKENS, MODEL, anthropic } from "../lib/anthropic";
import { pool, query, toVectorLiteral } from "../lib/db";
import { reconcileCitations, toSearchResults } from "../lib/rag/citations";
import { embedQuery, OFFLINE } from "../lib/rag/embed";
import { checkGrounding } from "../lib/rag/guardrails";
import { DECLINE_INSTRUCTION, DRAFTING_SYSTEM_PROMPT } from "../lib/rag/prompt";
import { retrieve } from "../lib/rag/retrieve";

interface QuestionSpec {
  slug: string;
  question: string;
  paraphrases?: string[];
  expect?: "answer" | "decline";
  note?: string;
}

const QUESTIONS_PATH = path.resolve(process.cwd(), "..", "content", "questions.yaml");

function loadQuestions(): QuestionSpec[] {
  const specs = parse(readFileSync(QUESTIONS_PATH, "utf-8")) as QuestionSpec[];

  const seen = new Set<string>();
  for (const spec of specs) {
    if (!spec.slug || !spec.question) {
      throw new Error(`entry missing slug or question: ${JSON.stringify(spec)}`);
    }
    if (seen.has(spec.slug)) throw new Error(`duplicate slug: ${spec.slug}`);
    seen.add(spec.slug);
  }
  return specs;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    limit: get("--limit") ? Number(get("--limit")) : undefined,
    slug: get("--slug"),
    force: argv.includes("--force"),
  };
}

async function draftOne(spec: QuestionSpec): Promise<boolean> {
  const isDecline = spec.expect === "decline";
  console.log(`\n── ${spec.slug}${isDecline ? "  [must decline]" : ""}`);
  console.log(`   ${spec.question}`);

  // Retrieve against the canonical question plus its paraphrases: different
  // wordings surface different evidence, and the draft should see the union.
  const retrievalQuery = [spec.question, ...(spec.paraphrases ?? [])].join(" ");
  const chunks = await retrieve(retrievalQuery, { topK: 14 });

  if (chunks.length === 0 && !isDecline) {
    console.log("   SKIPPED — no sources retrieved; nothing to ground an answer in");
    return false;
  }
  console.log(`   retrieved ${chunks.length} chunks`);

  const userContent = [
    ...toSearchResults(chunks),
    {
      type: "text" as const,
      text: isDecline
        ? `${DECLINE_INSTRUCTION}\n\nThe question: ${spec.question}`
        : spec.question,
    },
  ];

  // The params are cast because `search_result` blocks and `output_config` are
  // newer than the installed SDK's typings; the response is cast back to
  // Message so the rest of this function stays type-checked.
  const response = (await anthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: DRAFTING_SYSTEM_PROMPT,
        // Byte-identical across every question in the batch, so this prefix is
        // written once and read for the rest of the run.
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: userContent }],
  } as never)) as AnthropicMessage;

  // Opus 5's classifiers can decline outright — a 200 with empty content. Check
  // before reading content or this looks like a successful empty answer.
  if (response.stop_reason === "refusal") {
    console.log("   SKIPPED — model safety system declined this request");
    return false;
  }

  // Thinking blocks also appear in content on Opus 5; only text blocks carry
  // the answer.
  const body = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();

  if (!body) {
    console.log("   SKIPPED — empty response");
    return false;
  }

  const citations = reconcileCitations(response.content, chunks);
  const grounding = checkGrounding(
    body,
    citations.map((c) => c.citedText),
    citations.map((c) => c.canonicalRef),
  );

  console.log(
    `   drafted ${body.length} chars, ${citations.length} citations` +
      (grounding.unverified.length > 0
        ? `  ⚠ ${grounding.unverified.length} unverified reference(s)`
        : ""),
  );

  // Embed the canonical question and every paraphrase. These are what a user's
  // wording is matched against at runtime.
  const phrasings = [spec.question, ...(spec.paraphrases ?? [])];
  const embeddings: (number[] | null)[] = [];
  for (const phrasing of phrasings) {
    embeddings.push(await embedQuery(phrasing));
  }

  if (embeddings.some((e) => e === null)) {
    console.log(
      "   SKIPPED — no embeddings available (set VOYAGE_API_KEY; " +
        "answers are unmatchable without them)",
    );
    return false;
  }

  await query("begin");
  try {
    const rows = await query<{ id: string }>(
      `insert into answers (slug, question, body, status, generated_by,
                            generated_at, grounding)
       values ($1, $2, $3, 'draft', $4, now(), $5)
       on conflict (slug) do update set
         question     = excluded.question,
         body         = excluded.body,
         generated_by = excluded.generated_by,
         generated_at = excluded.generated_at,
         grounding    = excluded.grounding,
         status       = 'draft',
         updated_at   = now()
       returning id`,
      [spec.slug, spec.question, body, MODEL, JSON.stringify(grounding)],
    );
    const answerId = Number(rows[0].id);

    // Replace rather than append: a redraft must not leave stale phrasings or
    // citations pointing at evidence the new draft never used.
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
      // `canonical_ref` is copied from the chunk, not stored as a pointer to
      // it: the chunk row will be deleted and recreated by the next ingest,
      // while the printed location it names does not change. `rebindCitations`
      // uses this to find the passage again afterwards.
      await query(
        `insert into answer_citations (answer_id, chunk_id, ordinal, cited_text,
                                       canonical_ref)
         select $1, $2, $3, $4,
                coalesce(nullif(c.canonical_ref, ''), d.canonical_ref)
           from chunks c join documents d on d.id = c.document_id
          where c.id = $2`,
        [answerId, c.chunkId, c.ordinal, c.citedText],
      );
    }

    await query("commit");
  } catch (err) {
    await query("rollback");
    throw err;
  }

  return true;
}

async function main() {
  const args = parseArgs();

  if (OFFLINE) {
    console.error(
      "DEEN_OFFLINE=1 is set. Drafting needs real embeddings and a real model —\n" +
        "answers drafted against placeholder vectors would be grounded in\n" +
        "randomly chosen verses. Unset DEEN_OFFLINE.",
    );
    process.exit(1);
  }

  let specs = loadQuestions();
  console.log(`loaded ${specs.length} questions from content/questions.yaml`);

  if (args.slug) {
    specs = specs.filter((s) => s.slug === args.slug);
    if (specs.length === 0) {
      console.error(`no question with slug "${args.slug}"`);
      process.exit(1);
    }
  }

  // Published answers are human-approved; never silently replace one.
  const existing = await query<{ slug: string; status: string }>(
    `select slug, status from answers`,
  );
  const status = new Map(existing.map((r) => [r.slug, r.status]));

  specs = specs.filter((s) => {
    const current = status.get(s.slug);
    if (current === "published") {
      console.log(`skipping ${s.slug} — already published (edit via the review UI)`);
      return false;
    }
    if (current && !args.force) {
      console.log(`skipping ${s.slug} — already drafted (use --force to redraft)`);
      return false;
    }
    return true;
  });

  if (args.limit) specs = specs.slice(0, args.limit);

  if (specs.length === 0) {
    console.log("\nnothing to draft.");
    await pool.end();
    return;
  }

  console.log(`\ndrafting ${specs.length} answer(s) with ${MODEL} at effort=${EFFORT}`);

  let drafted = 0;
  let failed = 0;
  for (const spec of specs) {
    try {
      if (await draftOne(spec)) drafted++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(`   FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    `\n${drafted} drafted, ${failed} skipped or failed.\n` +
      `All drafts are status='draft' and invisible to readers until reviewed at /review.`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
