"""Embedding and reranking with BGE-M3, running on this machine.

Why local rather than a hosted API: this corpus is ~37M tokens of classical
Arabic, and chunking will change more than once before it settles. Re-embedding
must be free and unmetered, or every improvement to the chunker becomes a
spending decision.

BGE-M3 emits 1024 dimensions — the same as voyage-4 and the same as the
`vector(1024)` column — so the backend is switchable without a migration. It is
**not** switchable without re-embedding: vectors from two different models
occupy different spaces, and mixing them degrades retrieval silently rather than
raising anything.

The model is loaded lazily and once. Import cost is otherwise paid by every
process that touches this module, including ones that never embed anything.
"""

from __future__ import annotations

import sys
import threading
from typing import Literal, Sequence

from config import (
    EMBEDDING_DIM,
    LOCAL_BATCH_SIZE,
    LOCAL_EMBEDDING_MODEL,
    LOCAL_RERANK_MODEL,
    RERANK_MAX_TOKENS,
)

InputType = Literal["document", "query"]

# How many texts to hand the model between checkpoint flushes. Larger than the
# GPU batch size on purpose: the batch size is bounded by VRAM, this is bounded
# by how much work we are willing to lose to a crash.
LOCAL_CHUNK = 256

_model = None
_reranker = None
_lock = threading.Lock()


class LocalEmbeddingError(RuntimeError):
    pass


def _require_deps():
    try:
        import torch  # noqa: F401
        from sentence_transformers import SentenceTransformer  # noqa: F401
    except ImportError as exc:  # pragma: no cover - environment guard
        raise LocalEmbeddingError(
            "local embedding needs torch and sentence-transformers:\n"
            "  cd ingest && .venv/bin/pip install torch sentence-transformers\n"
            "Or set EMBEDDING_BACKEND=voyage to use the hosted API instead."
        ) from exc


def device() -> str:
    """CUDA when available, else CPU.

    CPU works and is worth keeping supported — it is roughly 20x slower, which
    is tolerable for a query and painful for a corpus.
    """
    _require_deps()
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def get_model():
    """Load BGE-M3 once, thread-safely.

    The lock matters: the embedding service handles concurrent requests, and two
    threads racing to load a 2 GB model would either duplicate it in VRAM or
    fail outright.
    """
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _require_deps()
                import torch
                from sentence_transformers import SentenceTransformer

                dev = device()
                _model = SentenceTransformer(
                    LOCAL_EMBEDDING_MODEL,
                    device=dev,
                    # fp16 on GPU roughly halves VRAM and costs nothing
                    # measurable in retrieval quality. Full precision on CPU,
                    # where fp16 is slower rather than faster.
                    model_kwargs=(
                        {"torch_dtype": torch.float16} if dev == "cuda" else {}
                    ),
                )
                # Renamed in sentence-transformers 5.x; the old name still
                # works but warns. Prefer the new one where present.
                dim = (
                    _model.get_embedding_dimension()
                    if hasattr(_model, "get_embedding_dimension")
                    else _model.get_sentence_embedding_dimension()
                )
                if dim != EMBEDDING_DIM:
                    raise LocalEmbeddingError(
                        f"{LOCAL_EMBEDDING_MODEL} emits {dim} dimensions but the "
                        f"schema declares vector({EMBEDDING_DIM}). Change the model "
                        f"or migrate the column — do not mix the two."
                    )
    return _model


def get_reranker():
    global _reranker
    if _reranker is None:
        with _lock:
            if _reranker is None:
                _require_deps()
                import torch
                from sentence_transformers import CrossEncoder

                dev = device()
                # fp16 for the same reason as the embedder, and here it is not
                # optional: embedder and reranker share one 6 GB card, and in
                # fp32 the pair leaves ~200 MB headroom and OOMs on load.
                _reranker = CrossEncoder(
                    LOCAL_RERANK_MODEL,
                    device=dev,
                    # bge-reranker-v2-m3 accepts 8192 tokens, and left at that
                    # the pairs in a batch pad to the longest one. Chunks target
                    # 650 tokens but the tail of the distribution runs to 15,000
                    # characters, and one of those in a batch allocated 1.37 GiB
                    # and took the service down mid-run. 1024 clears the target
                    # size with room to spare, so nothing typical is touched;
                    # the rare long chunk is scored on its first 1024 tokens,
                    # which is a far better outcome than a 500.
                    max_length=RERANK_MAX_TOKENS,
                    model_kwargs=(
                        {"torch_dtype": torch.float16} if dev == "cuda" else {}
                    ),
                )
    return _reranker


def embed_texts_local(
    texts: Sequence[str],
    *,
    input_type: InputType = "document",
    progress: bool = True,
    batch_size: int | None = None,
) -> list[list[float]]:
    """Embed `texts`, returning unit-normalised vectors in the same order.

    Note there is no `input_type` asymmetry here, unlike Voyage. BGE-M3 was
    trained without instruction prefixes for retrieval, and adding one degrades
    it. The parameter is accepted so this is a drop-in for the Voyage path, and
    deliberately ignored.
    """
    if not texts:
        return []

    model = get_model()
    vectors = model.encode(
        list(texts),
        batch_size=batch_size or LOCAL_BATCH_SIZE,
        # Cosine distance in pgvector assumes unit vectors; normalising here
        # means the index and the query agree without further scaling.
        normalize_embeddings=True,
        show_progress_bar=progress and len(texts) > 1,
        convert_to_numpy=True,
    )
    return [v.tolist() for v in vectors]


def _free_vram() -> None:
    """Hand cached blocks back to the driver before retrying a failed batch.

    Torch keeps freed allocations in its own pool, so the retry would meet the
    same shortage the first attempt did unless the cache is emptied first.
    """
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:  # pragma: no cover - best effort before a retry
        pass


def rerank_local(
    query: str, documents: Sequence[str], top_k: int
) -> list[tuple[int, float]]:
    """Score `documents` against `query`, best first, as (index, score).

    Scores are 0..1, comparable with Voyage's `relevance_score`, so a single
    MATCH_THRESHOLD means the same thing on either backend.

    Do **not** add a sigmoid here. `CrossEncoder.predict` already applies the
    model's own activation — Sigmoid for bge-reranker-v2-m3 — so squashing again
    maps the real 0.0–1.0 range onto 0.5–0.73. That does not look broken: every
    score merely creeps above a 0.5 threshold, and unrelated answers start
    matching. It is checked rather than assumed, because a model configured with
    an identity activation really would return logits.
    """
    if not documents:
        return []

    import numpy as np
    from torch import nn

    model = get_reranker()
    pairs = [(query, d) for d in documents]

    # Halve the batch and try again on an out-of-memory error. The embedder and
    # the reranker share one 6 GB card, so how much is free depends on what the
    # other one is doing at that instant — a batch size that works all morning
    # can fail once. Retrying costs a second; failing loses the request.
    batch = LOCAL_BATCH_SIZE
    while True:
        try:
            raw = model.predict(pairs, batch_size=batch, show_progress_bar=False)
            break
        except Exception as exc:  # noqa: BLE001 - torch OOM is not a typed error
            if "out of memory" not in str(exc).lower() or batch <= 1:
                raise
            batch //= 2
            _free_vram()
            sys.stderr.write(f"  rerank OOM, retrying at batch_size={batch}\n")

    scores = np.asarray(raw, dtype=float)

    if not isinstance(getattr(model, "activation_fn", None), nn.Sigmoid):
        scores = 1.0 / (1.0 + np.exp(-scores))

    ranked = sorted(enumerate(scores.tolist()), key=lambda p: -p[1])
    return [(i, float(s)) for i, s in ranked[:top_k]]
