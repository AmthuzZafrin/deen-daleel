/**
 * Review API: read drafts, approve, reject, edit.
 *
 * This is the gate the whole design rests on — nothing reaches a reader without
 * passing through here.
 *
 * Guarded by `denyReview` on every handler; see lib/reviewAuth.ts for what that
 * checks and why it is a shared secret rather than accounts.
 */

import type { NextRequest } from "next/server";

import { query, toVectorLiteral } from "@/lib/db";
import { EMBEDDING_DIM } from "@/lib/env";
import { REF_COLUMNS } from "@/lib/rag/refs";
import { attachTranslations } from "@/lib/rag/translations";
import { denyReview } from "@/lib/reviewAuth";
import { sectionsBySlug } from "@/lib/sections";
import type { Citation, Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Reads are gated too, not only writes: drafts are unreviewed material that
  // must never be mistaken for guidance, and the miss log is a record of what
  // real people have asked.
  const denied = denyReview(req);
  if (denied) return denied;

  const status = req.nextUrl.searchParams.get("status") ?? "draft";

  const answers = await query<Record<string, unknown>>(
    `select id, slug, question, body, status, generated_by, generated_at,
            reviewed_by, reviewed_at, review_notes, grounding
       from answers
      where ($1 = 'all' or status = $1)
      order by updated_at desc`,
    [status],
  );

  if (answers.length === 0) {
    return Response.json({
      answers: [],
      counts: await counts(),
      misses: await missStats(),
    });
  }

  const ids = answers.map((a) => Number(a.id));

  const citationRows = await query<Record<string, unknown>>(
    `select ac.answer_id, ac.ordinal, ac.cited_text,
            c.id as chunk_id, c.kind,
            ${REF_COLUMNS},
            d.permalink, d.arabic_text, d.english_text,
            s.title as source_title, s.attribution
       from answer_citations ac
       join chunks    c on c.id = ac.chunk_id
       join documents d on d.id = c.document_id
       join sources   s on s.id = c.source_id
      where ac.answer_id = any($1)
      order by ac.answer_id, ac.ordinal`,
    [ids],
  );

  const phrasingRows = await query<{ answer_id: string; text: string }>(
    `select answer_id, text from answer_questions
      where answer_id = any($1) order by is_primary desc, id`,
    [ids],
  );

  const citationsBy = new Map<number, Citation[]>();
  const sourcesBy = new Map<number, Source[]>();
  for (const r of citationRows) {
    const aid = Number(r.answer_id);
    const chunkId = Number(r.chunk_id);
    const cs = citationsBy.get(aid) ?? [];
    cs.push({
      ordinal: Number(r.ordinal),
      chunkId,
      canonicalRef: String(r.canonical_ref),
      citedText: String(r.cited_text),
    });
    citationsBy.set(aid, cs);

    const ss = sourcesBy.get(aid) ?? [];
    if (!ss.some((s) => s.chunkId === chunkId)) {
      ss.push({
        chunkId,
        canonicalRef: String(r.canonical_ref),
        kind: r.kind as Source["kind"],
        sourceTitle: String(r.source_title),
        permalink: (r.permalink as string) ?? null,
        arabicText: (r.arabic_text as string) ?? null,
        englishText: (r.english_text as string) ?? null,
        attribution: (r.attribution as string) ?? null,
        chapterLevel: Boolean(r.chapter_level),
        translations: [],
      });
    }
    sourcesBy.set(aid, ss);
  }

  // A reviewer should see exactly the English the reader will, and on the same
  // page as the Arabic it is paired with -- checking the pairing is part of
  // what there is to review.
  await attachTranslations([...sourcesBy.values()].flat());

  const phrasingsBy = new Map<number, string[]>();
  for (const r of phrasingRows) {
    const aid = Number(r.answer_id);
    phrasingsBy.set(aid, [...(phrasingsBy.get(aid) ?? []), r.text]);
  }

  const sections = sectionsBySlug();

  return Response.json({
    counts: await counts(),
    misses: await missStats(),
    sectionProgress: await sectionProgress(),
    answers: answers.map((a) => {
      const id = Number(a.id);
      return {
        id,
        slug: a.slug,
        section: sections.get(String(a.slug)) ?? null,
        question: a.question,
        body: a.body,
        status: a.status,
        generatedBy: a.generated_by,
        reviewedBy: a.reviewed_by,
        reviewNotes: a.review_notes,
        grounding: a.grounding,
        phrasings: phrasingsBy.get(id) ?? [],
        citations: citationsBy.get(id) ?? [],
        sources: sourcesBy.get(id) ?? [],
      };
    }),
  });
}

async function counts() {
  const rows = await query<{ status: string; n: string }>(
    `select status, count(*)::text as n from answers group by status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

export interface SectionProgress {
  index: number;
  title: string;
  total: number;
  published: number;
  rejected: number;
  remaining: number;
}

/**
 * How far review has got, per editorial section.
 *
 * With a bank of tens a flat list was fine. At 469 it is a wall, and a wall is
 * demoralising in a way that matters here — this is one person reading 395,000
 * words, and the difference between "469 to go" and "section 1: 4 of 21" is
 * whether the work looks finishable. It also makes it possible to publish a
 * coherent tranche rather than a scattering.
 */
async function sectionProgress(): Promise<SectionProgress[]> {
  const rows = await query<{ slug: string; status: string }>(
    `select slug, status from answers`,
  );
  const sections = sectionsBySlug();

  const acc = new Map<number, SectionProgress>();
  for (const row of rows) {
    const section = sections.get(row.slug);
    if (!section) continue;

    const entry = acc.get(section.index) ?? {
      index: section.index,
      title: section.title,
      total: 0,
      published: 0,
      rejected: 0,
      remaining: 0,
    };
    entry.total++;
    if (row.status === "published") entry.published++;
    else if (row.status === "rejected") entry.rejected++;
    else entry.remaining++;
    acc.set(section.index, entry);
  }

  return [...acc.values()].sort((a, b) => a.index - b.index);
}

/**
 * The miss rate and the questions behind it.
 *
 * This is the editorial work queue. Coverage is bounded by how many answers
 * have been written, so the questions readers actually asked and did not get an
 * answer to are the only honest guide to what to write next — better than
 * guessing at a curated list in the abstract.
 *
 * Near misses are worth separating out: a question that scored just under the
 * threshold may already be covered by an existing answer that simply needs
 * another phrasing added, which is far less work than writing a new one.
 */
async function missStats() {
  const [totals] = await query<{ total: string; missed: string }>(
    `select count(*)::text as total,
            count(*) filter (where not matched)::text as missed
       from query_log`,
  );

  const unmatched = await query<{
    query_text: string;
    n: string;
    best_score: number | null;
    top_answer_id: string | null;
    top_slug: string | null;
  }>(
    `select q.query_text,
            count(*)::text as n,
            max(q.top_score) as best_score,
            (array_agg(q.top_answer_id order by q.top_score desc nulls last))[1] as top_answer_id,
            (array_agg(a.slug order by q.top_score desc nulls last))[1] as top_slug
       from query_log q
       left join answers a on a.id = q.top_answer_id
      where not q.matched
      group by q.query_text
      order by count(*) desc, max(q.top_score) desc nulls last
      limit 50`,
  );

  const total = Number(totals?.total ?? 0);
  const missed = Number(totals?.missed ?? 0);

  return {
    total,
    missed,
    missRate: total > 0 ? missed / total : 0,
    unmatched: unmatched.map((r) => ({
      queryText: r.query_text,
      count: Number(r.n),
      bestScore: r.best_score,
      topAnswerId: r.top_answer_id ? Number(r.top_answer_id) : null,
      topSlug: r.top_slug,
    })),
  };
}

interface ReviewAction {
  id: number;
  action: "publish" | "reject" | "save";
  reviewedBy?: string;
  notes?: string;
  body?: string;
}

export async function POST(req: NextRequest) {
  const denied = denyReview(req);
  if (denied) return denied;

  let payload: ReviewAction;
  try {
    payload = (await req.json()) as ReviewAction;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { id, action } = payload;
  if (!id || !action) {
    return Response.json({ error: "id and action are required" }, { status: 400 });
  }

  // Every branch returns the row it changed. Without it a typo'd id answered
  // `{ok:true}` and the reviewer had no way to know nothing had happened —
  // the worst shape of failure on a page whose whole job is being sure.
  let touched: { id: number }[];

  if (action === "publish") {
    // A reviewer's name is required, not optional: an answer published by
    // nobody in particular is exactly what this design exists to prevent, and
    // the name is shown to readers.
    const reviewedBy = payload.reviewedBy?.trim();
    if (!reviewedBy) {
      return Response.json(
        { error: "reviewedBy is required to publish" },
        { status: 400 },
      );
    }

    // An answer is matched through its phrasings, so one whose phrasings were
    // never embedded is reachable only by the lexical arm — it degrades to
    // keyword search and nothing anywhere says so. Refuse rather than publish
    // something that will quietly under-perform. `scripts/embedAnswerQuestions.ts
    // --missing` is the fix, and the message says so.
    const unembedded = await query<{ n: string }>(
      `select count(*) as n
         from answer_questions
        where answer_id = $1
          and (embedding is null or embedding = $2::vector)`,
      [id, toVectorLiteral(new Array(EMBEDDING_DIM).fill(0))],
    );
    if (Number(unembedded[0]?.n ?? 0) > 0) {
      return Response.json(
        {
          error:
            "this answer's question phrasings are not embedded yet, so it would " +
            "only be matchable by keyword. Run: npx tsx scripts/embedAnswerQuestions.ts --missing",
        },
        { status: 409 },
      );
    }

    touched = await query<{ id: number }>(
      `update answers
          set status = 'published', reviewed_by = $2, reviewed_at = now(),
              published_at = now(), review_notes = $3, updated_at = now()
        where id = $1
      returning id`,
      [id, reviewedBy, payload.notes ?? null],
    );
  } else if (action === "reject") {
    touched = await query<{ id: number }>(
      `update answers
          set status = 'rejected', reviewed_by = $2, reviewed_at = now(),
              review_notes = $3, updated_at = now()
        where id = $1
      returning id`,
      [id, payload.reviewedBy?.trim() ?? null, payload.notes ?? null],
    );
  } else if (action === "save") {
    if (typeof payload.body !== "string" || !payload.body.trim()) {
      return Response.json({ error: "body is required" }, { status: 400 });
    }
    // Editing does not publish. A reviewer's correction still has to be
    // approved explicitly afterwards.
    touched = await query<{ id: number }>(
      `update answers set body = $2, updated_at = now() where id = $1
      returning id`,
      [id, payload.body],
    );
  } else {
    return Response.json({ error: `unknown action: ${action}` }, { status: 400 });
  }

  if (touched.length === 0) {
    return Response.json({ error: `no answer with id ${id}` }, { status: 404 });
  }

  return Response.json({ ok: true });
}
