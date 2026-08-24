"""Embedding via Voyage AI.

Anthropic has no embeddings endpoint, so the vector half of retrieval comes from
Voyage. Two details here matter more than they look:

1. `input_type` is asymmetric. Documents are embedded with `input_type="document"`
   and queries with `input_type="query"`. Voyage prepends a different internal
   prompt for each, and using the same value on both sides measurably degrades
   retrieval. The web app's `lib/rag/embed.ts` must use "query".

2. Runs are checkpointed. Embedding a full corpus is the slow, paid step of the
   pipeline; a crash two-thirds of the way through must not mean paying for it
   twice.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import time
from pathlib import Path
from typing import Iterable, Literal, Sequence

import httpx

from config import (
    CHECKPOINT_DIR,
    EMBEDDING_BACKEND,
    EMBEDDING_BATCH_SIZE,
    EMBEDDING_DIM,
    EMBEDDING_MODEL,
    VOYAGE_API_KEY,
    VOYAGE_EMBEDDING_MODEL,
)

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
InputType = Literal["document", "query"]


class EmbeddingError(RuntimeError):
    pass


# --------------------------------------------------------------------------
# Offline mode
# --------------------------------------------------------------------------


def fake_embedding(text: str) -> list[float]:
    """A deterministic pseudo-embedding for offline pipeline testing.

    This exists so the full parse → chunk → load path can be exercised without
    an API key or spend. It encodes no semantics whatsoever: identical text maps
    to identical vectors, and nothing else is meaningful. Retrieval quality with
    these is noise by construction.
    """
    seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
    rng = random.Random(seed)
    vec = [rng.gauss(0.0, 1.0) for _ in range(EMBEDDING_DIM)]
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


# --------------------------------------------------------------------------
# Voyage
# --------------------------------------------------------------------------


def _post_batch(
    client: httpx.Client, texts: Sequence[str], input_type: InputType
) -> list[list[float]]:
    """One Voyage call, retrying on rate limits and transient server errors."""
    payload = {
        "input": list(texts),
        "model": VOYAGE_EMBEDDING_MODEL,
        "input_type": input_type,
    }
    delay = 2.0

    for attempt in range(6):
        try:
            resp = client.post(VOYAGE_URL, json=payload, timeout=120)
        except httpx.RequestError as exc:
            if attempt == 5:
                raise EmbeddingError(f"network failure calling Voyage: {exc}") from exc
            time.sleep(delay)
            delay *= 2
            continue

        if resp.status_code == 200:
            data = resp.json()["data"]
            # Voyage documents index-ordered results, but sorting explicitly
            # makes the batch->text alignment independent of that guarantee. A
            # silent misalignment here would attach every chunk to the wrong
            # vector, which is close to undetectable downstream.
            ordered = sorted(data, key=lambda d: d["index"])
            return [d["embedding"] for d in ordered]

        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt == 5:
                raise EmbeddingError(
                    f"Voyage still failing after retries: {resp.status_code} {resp.text[:200]}"
                )
            retry_after = float(resp.headers.get("retry-after", delay))
            time.sleep(retry_after)
            delay *= 2
            continue

        raise EmbeddingError(f"Voyage error {resp.status_code}: {resp.text[:300]}")

    raise EmbeddingError("unreachable")


# --------------------------------------------------------------------------
# Checkpointing, shared by both backends
# --------------------------------------------------------------------------


def _key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _checkpoint_path(checkpoint: str) -> Path:
    """Checkpoint file for this run, namespaced by the model that produced it.

    The model must be part of the filename. Vectors from two models are not
    comparable, so a checkpoint written by voyage-4 and reused by BGE-M3 would
    silently seed the corpus with vectors from the wrong space — no error, just
    retrieval that quietly stops working.
    """
    slug = EMBEDDING_MODEL.replace("/", "-").replace(":", "-")
    return CHECKPOINT_DIR / f"{checkpoint}.{slug}.jsonl"


def _load_checkpoint(
    checkpoint: str | None, progress: bool
) -> tuple[dict[str, list[float]], Path | None]:
    """Read any previously completed embeddings for this run."""
    cache: dict[str, list[float]] = {}
    if not checkpoint:
        return cache, None

    ckpt_path = _checkpoint_path(checkpoint)
    if ckpt_path.exists():
        with ckpt_path.open(encoding="utf-8") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                    cache[rec["h"]] = rec["e"]
                except (json.JSONDecodeError, KeyError):
                    continue  # tolerate a torn final line from a hard crash
        if cache and progress:
            print(f"  resuming: {len(cache)} embeddings from checkpoint")
    return cache, ckpt_path


def _embed_local_checkpointed(
    texts: Sequence[str],
    *,
    input_type: InputType,
    checkpoint: str | None,
    progress: bool,
) -> list[list[float]]:
    """Local BGE-M3 path, checkpointed on the same terms as the Voyage one.

    Checkpointing still earns its place without an API bill behind it: embedding
    the full corpus is hours of GPU time, and a crash near the end must not cost
    all of it.
    """
    from embed_local import LOCAL_CHUNK, embed_texts_local

    cache, ckpt_path = _load_checkpoint(checkpoint, progress)

    pending = [t for t in texts if _key(t) not in cache]
    unique_pending = list(dict.fromkeys(pending))

    if unique_pending:
        fh = ckpt_path.open("a", encoding="utf-8") if ckpt_path else None
        try:
            total = (len(unique_pending) + LOCAL_CHUNK - 1) // LOCAL_CHUNK
            for i in range(0, len(unique_pending), LOCAL_CHUNK):
                batch = unique_pending[i : i + LOCAL_CHUNK]
                vectors = embed_texts_local(
                    batch, input_type=input_type, progress=False
                )
                for text, vec in zip(batch, vectors):
                    if len(vec) != EMBEDDING_DIM:
                        raise EmbeddingError(
                            f"expected {EMBEDDING_DIM} dims from {EMBEDDING_MODEL}, "
                            f"got {len(vec)}; the vector column must match"
                        )
                    cache[_key(text)] = vec
                    if fh:
                        fh.write(json.dumps({"h": _key(text), "e": vec}) + "\n")
                if fh:
                    fh.flush()
                if progress:
                    n = i // LOCAL_CHUNK + 1
                    print(f"  embedded batch {n}/{total}", flush=True)
        finally:
            if fh:
                fh.close()

    return [cache[_key(t)] for t in texts]


def embed_texts(
    texts: Sequence[str],
    *,
    input_type: InputType = "document",
    offline: bool = False,
    checkpoint: str | None = None,
    progress: bool = True,
) -> list[list[float]]:
    """Embed `texts`, returning vectors in the same order.

    If `checkpoint` is given, completed batches are written to
    `ingest/.checkpoints/<name>.jsonl` and reused on a subsequent run.
    """
    if offline:
        return [fake_embedding(t) for t in texts]

    if EMBEDDING_BACKEND == "local":
        return _embed_local_checkpointed(
            texts, input_type=input_type, checkpoint=checkpoint, progress=progress
        )

    if not VOYAGE_API_KEY:
        raise EmbeddingError(
            "VOYAGE_API_KEY is not set. Add it to .env, or pass --offline to run "
            "the pipeline with placeholder vectors (no retrieval quality)."
        )

    cache, ckpt_path = _load_checkpoint(checkpoint, progress)
    key = _key

    pending = [t for t in texts if key(t) not in cache]
    unique_pending = list(dict.fromkeys(pending))  # de-dupe, preserve order

    if unique_pending:
        headers = {"Authorization": f"Bearer {VOYAGE_API_KEY}"}
        with httpx.Client(headers=headers) as client:
            total = (len(unique_pending) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE
            fh = ckpt_path.open("a", encoding="utf-8") if ckpt_path else None
            try:
                for i in range(0, len(unique_pending), EMBEDDING_BATCH_SIZE):
                    batch = unique_pending[i : i + EMBEDDING_BATCH_SIZE]
                    vectors = _post_batch(client, batch, input_type)
                    if len(vectors) != len(batch):
                        raise EmbeddingError(
                            f"Voyage returned {len(vectors)} vectors for {len(batch)} inputs"
                        )
                    for text, vec in zip(batch, vectors):
                        if len(vec) != EMBEDDING_DIM:
                            raise EmbeddingError(
                                f"expected {EMBEDDING_DIM} dims from {EMBEDDING_MODEL}, "
                                f"got {len(vec)}; the vector column must match"
                            )
                        cache[key(text)] = vec
                        if fh:
                            fh.write(
                                json.dumps({"h": key(text), "e": vec}) + "\n"
                            )
                    if fh:
                        fh.flush()
                    if progress:
                        n = i // EMBEDDING_BATCH_SIZE + 1
                        print(f"  embedded batch {n}/{total}", flush=True)
            finally:
                if fh:
                    fh.close()

    return [cache[key(t)] for t in texts]


def embed_query(text: str, *, offline: bool = False) -> list[float]:
    """Embed a single search query. Note `input_type="query"`."""
    return embed_texts([text], input_type="query", offline=offline, progress=False)[0]


# Tokens per character, measured against BGE-M3's tokenizer over 300 paragraphs
# of Tabari: 35,991 tokens from 103,838 Arabic characters.
#
# The earlier guess of 0.75 overshot by 1.84x, which was not harmless — it made
# every chunk about half its intended size, so each carried less context than
# the budget allowed and the corpus produced roughly twice as many chunks as it
# needed. Re-measure if the embedding model changes.
_ARABIC_TOKENS_PER_CHAR = 0.35
_LATIN_TOKENS_PER_CHAR = 0.25


def estimate_tokens(text: str) -> int:
    """Rough token count for budgeting the model's context.

    Approximate by design — it sizes chunks, it does not bill anything — but
    calibrated, because a systematic bias here silently changes chunk size.
    """
    arabic = sum(1 for ch in text if "؀" <= ch <= "ۿ")
    latin = len(text) - arabic
    return int(arabic * _ARABIC_TOKENS_PER_CHAR + latin * _LATIN_TOKENS_PER_CHAR) + 1
