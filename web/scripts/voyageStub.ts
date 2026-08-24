/**
 * A local stand-in for the Voyage API, for exercising the retrieval and match
 * path without a real key.
 *
 * It is **not** a simulator of Voyage's quality — it scores by token overlap,
 * which is far cruder than a real reranker. Its job is to prove the plumbing:
 * that a query reaches the arms, that fusion picks candidates, that a score
 * crosses the threshold, that the right answer is hydrated with its citations.
 * Match scores produced here say nothing about whether retrieval is any good.
 *
 * Usage:
 *   npx tsx scripts/voyageStub.ts &
 *   VOYAGE_BASE_URL=http://127.0.0.1:8788 VOYAGE_API_KEY=stub npm run dev
 */

import { createServer } from "node:http";

const PORT = Number(process.env.VOYAGE_STUB_PORT ?? 8788);
const DIM = 1024;

/** Deterministic unit-ish vector from a string. Stable across runs. */
function fakeEmbedding(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[Math.abs(h) % DIM] += 1;
  }
  const norm = Math.hypot(...vec) || 1;
  return vec.map((v) => v / norm);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/** Jaccard overlap, squashed into [0,1]. Crude on purpose — see the header. */
function similarity(query: string, doc: string): number {
  const q = new Set(tokenize(query));
  const d = new Set(tokenize(doc));
  if (q.size === 0 || d.size === 0) return 0;
  let shared = 0;
  for (const t of q) if (d.has(t)) shared++;
  return shared / new Set([...q, ...d]).size;
}

function readBody(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  try {
    const body = await readBody(req);

    if (req.url?.endsWith("/embeddings")) {
      const input = (body.input as string[]) ?? [];
      return send(200, {
        data: input.map((text, i) => ({
          index: i,
          embedding: fakeEmbedding(text),
        })),
      });
    }

    if (req.url?.endsWith("/rerank")) {
      const q = String(body.query ?? "");
      const docs = (body.documents as string[]) ?? [];
      const topK = Number(body.top_k ?? docs.length);
      const scored = docs
        .map((d, index) => ({ index, relevance_score: similarity(q, d) }))
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .slice(0, topK);
      return send(200, { data: scored });
    }

    return send(404, { error: `stub has no route for ${req.url}` });
  } catch (err) {
    return send(400, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`voyage stub listening on http://127.0.0.1:${PORT}`);
});
