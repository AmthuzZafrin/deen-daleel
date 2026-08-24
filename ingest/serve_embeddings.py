"""A local embedding + rerank service, speaking Voyage's wire format.

The web app must embed a query with the *same* model that embedded the corpus,
or retrieval returns confident nonsense rather than an error. BGE-M3 is a
PyTorch model and the app is TypeScript, so rather than port it, this exposes it
over HTTP on the two endpoints the app already knows how to call.

Because it mimics Voyage's request and response shapes, `web/lib/rag/embed.ts`
needs **no changes at all** — point `VOYAGE_BASE_URL` here and the existing
client works:

    cd ingest && .venv/bin/python -m serve_embeddings
    cd web && VOYAGE_BASE_URL=http://127.0.0.1:8001/v1 VOYAGE_API_KEY=local npm run dev

Deliberately not FastAPI: stdlib keeps the dependency footprint to torch alone,
and this serves one process on one machine.

Binds to 127.0.0.1 only. There is no authentication, because there is nothing to
authenticate — it holds no data and reaching it means already being on the host.
Do not bind it to a public interface.
"""

from __future__ import annotations

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from config import EMBEDDING_DIM, LOCAL_EMBEDDING_MODEL, LOCAL_RERANK_MODEL

HOST = os.getenv("EMBED_SERVICE_HOST", "127.0.0.1")
PORT = int(os.getenv("EMBED_SERVICE_PORT", "8001"))

# Refuse inputs that would blow up VRAM. BGE-M3 tops out at 8192 tokens; the
# app never sends more than a few dozen candidates at a time.
MAX_INPUTS = 256


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length) or b"{}")

    def log_message(self, fmt: str, *args) -> None:
        # One concise line per request instead of BaseHTTPRequestHandler's noise.
        sys.stderr.write(f"  {self.path} {fmt % args}\n")

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        if self.path.rstrip("/").endswith("/health"):
            return self._send(
                200,
                {
                    "status": "ok",
                    "embedding_model": LOCAL_EMBEDDING_MODEL,
                    "rerank_model": LOCAL_RERANK_MODEL,
                    "dimensions": EMBEDDING_DIM,
                },
            )
        return self._send(404, {"error": f"no route for {self.path}"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        from embed_local import embed_texts_local, rerank_local

        try:
            body = self._read_json()
        except json.JSONDecodeError as exc:
            return self._send(400, {"error": f"invalid JSON: {exc}"})

        path = self.path.rstrip("/")
        started = time.time()

        try:
            if path.endswith("/embeddings"):
                raw = body.get("input") or []
                # Voyage accepts a bare string as well as a list.
                texts = [raw] if isinstance(raw, str) else list(raw)
                if not texts:
                    return self._send(400, {"error": "input is required"})
                if len(texts) > MAX_INPUTS:
                    return self._send(
                        400, {"error": f"at most {MAX_INPUTS} inputs per request"}
                    )

                vectors = embed_texts_local(
                    texts,
                    input_type=body.get("input_type", "document"),
                    progress=False,
                )
                took = (time.time() - started) * 1000
                sys.stderr.write(f"  embedded {len(texts)} in {took:.0f}ms\n")
                return self._send(
                    200,
                    {
                        "object": "list",
                        "model": LOCAL_EMBEDDING_MODEL,
                        "data": [
                            {"object": "embedding", "index": i, "embedding": v}
                            for i, v in enumerate(vectors)
                        ],
                    },
                )

            if path.endswith("/rerank"):
                query = body.get("query") or ""
                documents = list(body.get("documents") or [])
                if not query or not documents:
                    return self._send(
                        400, {"error": "query and documents are required"}
                    )
                if len(documents) > MAX_INPUTS:
                    return self._send(
                        400, {"error": f"at most {MAX_INPUTS} documents per request"}
                    )

                top_k = int(body.get("top_k") or len(documents))
                ranked = rerank_local(query, documents, top_k)
                took = (time.time() - started) * 1000
                sys.stderr.write(f"  reranked {len(documents)} in {took:.0f}ms\n")
                return self._send(
                    200,
                    {
                        "object": "list",
                        "model": LOCAL_RERANK_MODEL,
                        "data": [
                            {"index": i, "relevance_score": s} for i, s in ranked
                        ],
                    },
                )

            return self._send(404, {"error": f"no route for {self.path}"})

        except Exception as exc:  # noqa: BLE001 - a dev service must not die
            sys.stderr.write(f"  ERROR {type(exc).__name__}: {exc}\n")
            return self._send(500, {"error": f"{type(exc).__name__}: {exc}"})


def main() -> None:
    # Load before binding the port, so the first request is not left waiting on
    # a multi-second model load and timing out.
    print(f"loading {LOCAL_EMBEDDING_MODEL} …", flush=True)
    from embed_local import device, get_model

    get_model()
    print(f"loaded on {device()}", flush=True)

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}/v1  (health: /v1/health)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
