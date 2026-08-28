/**
 * Published English for the hadith inside a passage.
 *
 * The corpus carries a translation for the Qur'an and for nothing else: 6,236
 * chunks of 140,379, and 158 of the 2,134 passages the answer bank cites. For
 * the other 93% the source panel could show a reader the Arabic and the
 * reference and then had to stop, which is a poor answer for someone who came
 * to check the daleel and cannot read it.
 *
 * These rows are the honest part of the gap that could be closed. They are not
 * generated — machine translation was tested against real cited passages and
 * turned `rak'a` into "knees" and inverted a ruling in Al-Mabsut. They are
 * published human translations, attached to a chunk by
 * `ingest/pipelines/hadith_english.py` only where the Arabic that was
 * translated was found in that chunk, in order, word for word.
 *
 * So this is a claim about part of a page, never the whole of it. A page of
 * Fath al-Bari quotes the hadith it comments on: the hadith matches and gets
 * its English, al-Asqalani's commentary around it does not and gets none. The
 * panel has to say that in those terms, and `coverage` is carried through so it
 * can say how much of the hadith it found.
 */

import { query } from "@/lib/db";
import type { Source } from "@/lib/types";

/** Loads translations for the given chunks, keyed by chunk id. */
export async function translationsFor(
  chunkIds: number[],
): Promise<Map<number, Source["translations"]>> {
  const out = new Map<number, Source["translations"]>();
  const ids = [...new Set(chunkIds)].filter((n) => Number.isFinite(n));
  if (ids.length === 0) return out;

  const rows = await query<Record<string, unknown>>(
    `select chunk_id, collection, hadith_number, edition,
            arabic_text, english_text, coverage
       from chunk_translations
      where chunk_id = any($1)
      order by chunk_id, char_offset`,
    [ids],
  );

  for (const r of rows) {
    const id = Number(r.chunk_id);
    const list = out.get(id) ?? [];
    list.push({
      collection: String(r.collection),
      hadithNumber: Number(r.hadith_number),
      edition: String(r.edition),
      arabicText: String(r.arabic_text),
      englishText: String(r.english_text),
      coverage: Number(r.coverage),
    });
    out.set(id, list);
  }
  return out;
}

/**
 * Fills in `translations` on sources that were built without them.
 *
 * Mutating rather than returning a new array: every caller has already assembled
 * its sources alongside citations that point at them by `chunkId`, and rebuilding
 * the list would mean rebuilding those references too.
 */
export async function attachTranslations(sources: Source[]): Promise<void> {
  if (sources.length === 0) return;
  const byChunk = await translationsFor(sources.map((s) => s.chunkId));
  for (const s of sources) s.translations = byChunk.get(s.chunkId) ?? [];
}
