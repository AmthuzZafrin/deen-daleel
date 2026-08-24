/**
 * Turning API citation blocks into UI-ready citations.
 *
 * Kept as a pure function, separate from the route, because this is the most
 * intricate step in the app and the one whose failure is least visible: a
 * mis-mapped citation still renders as a confident-looking reference. Isolating
 * it makes it testable without an API key or a live model call.
 */

import type { RetrievedChunk } from "./retrieve";

export interface ResolvedCitation {
  ordinal: number;
  chunkId: number;
  canonicalRef: string;
  citedText: string;
}

/** The citation shapes the API returns for `search_result` and `document` blocks. */
interface RawCitation {
  cited_text?: string;
  source?: string;
  title?: string | null;
  document_index?: number;
  search_result_index?: number;
}

interface RawTextBlock {
  type: string;
  text?: string;
  citations?: RawCitation[] | null;
}

/**
 * Map a citation back to the chunk it came from.
 *
 * Primary key is the `source` string we set on the outgoing block
 * (`chunk:<id>`), which round-trips through the API. `search_result_index` is
 * the fallback for the case where `source` is absent — it indexes into the
 * blocks in the order we sent them.
 */
function resolveChunk(
  citation: RawCitation,
  chunks: RetrievedChunk[],
  byChunkId: Map<number, RetrievedChunk>,
): RetrievedChunk | null {
  const source = citation.source ?? "";
  if (source.startsWith("chunk:")) {
    const id = Number(source.slice("chunk:".length));
    const hit = byChunkId.get(id);
    if (hit) return hit;
  }

  const index = citation.search_result_index ?? citation.document_index;
  if (typeof index === "number" && index >= 0 && index < chunks.length) {
    return chunks[index];
  }

  return null;
}

/**
 * Collect citations across the response's text blocks, de-duplicated and
 * numbered in the order they first appear — which is the order a reader
 * encounters them, so `[1]` is genuinely the first citation in the answer.
 */
export function reconcileCitations(
  content: unknown[],
  chunks: RetrievedChunk[],
): ResolvedCitation[] {
  const byChunkId = new Map(chunks.map((c) => [c.chunkId, c]));
  const out: ResolvedCitation[] = [];
  const seen = new Set<string>();

  for (const raw of content) {
    const block = raw as RawTextBlock;
    if (block.type !== "text" || !block.citations) continue;

    for (const citation of block.citations) {
      const chunk = resolveChunk(citation, chunks, byChunkId);
      if (!chunk) continue;

      const citedText = citation.cited_text ?? "";
      const key = `${chunk.chunkId}:${citedText}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        ordinal: out.length + 1,
        chunkId: chunk.chunkId,
        canonicalRef: chunk.canonicalRef,
        citedText,
      });
    }
  }

  return out;
}

/**
 * Build the citation-bearing content blocks sent to the model.
 *
 * `source` carries our chunk id so citations map straight back to the row;
 * `title` is the canonical reference, which the API returns on the citation and
 * the UI shows to the reader.
 */
export function toSearchResults(chunks: RetrievedChunk[]) {
  return chunks.map((chunk) => ({
    type: "search_result" as const,
    source: `chunk:${chunk.chunkId}`,
    title: chunk.canonicalRef,
    content: [{ type: "text" as const, text: chunk.content }],
    citations: { enabled: true },
  }));
}
