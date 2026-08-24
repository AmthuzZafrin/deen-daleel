"""Shared configuration for the ingestion pipelines."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
INGEST_DIR = ROOT / "ingest"
RAW_DIR = INGEST_DIR / "data" / "raw"
CHECKPOINT_DIR = INGEST_DIR / ".checkpoints"

load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://deen:deen@localhost:5433/deen_daleel"
)
VOYAGE_API_KEY = os.getenv("VOYAGE_API_KEY", "")

# Which embedding implementation to use: "local" runs BGE-M3 on this machine,
# "voyage" calls the hosted API.
#
# Local is the default because it costs nothing, needs no key, and has no quota
# to exhaust — this corpus is ~37M tokens of classical Arabic and will be
# re-embedded whenever chunking changes. Voyage stays reachable so neither
# choice is a lock-in.
EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "local").lower()

# 1024 dimensions, matching the `vector(1024)` column in
# db/migrations/0001_init.sql. Both models below emit exactly that, so the
# backend can be switched without a migration — but NOT without re-embedding:
# vectors from two different models are not comparable, and mixing them yields
# plausible-looking nonsense rather than an error.
EMBEDDING_DIM = 1024

# BAAI/bge-m3: MIT licence, 100+ languages, 8192-token context, 1024 dims.
# Chosen for Arabic specifically — most open embedding models are trained
# overwhelmingly on English and degrade badly on classical Arabic prose.
LOCAL_EMBEDDING_MODEL = os.getenv("LOCAL_EMBEDDING_MODEL", "BAAI/bge-m3")
LOCAL_RERANK_MODEL = os.getenv("LOCAL_RERANK_MODEL", "BAAI/bge-reranker-v2-m3")

VOYAGE_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "voyage-4")
EMBEDDING_MODEL = (
    LOCAL_EMBEDDING_MODEL if EMBEDDING_BACKEND == "local" else VOYAGE_EMBEDDING_MODEL
)

# Voyage batches by request size; local batches by VRAM. 6 GB of RTX 4050 holds
# BGE-M3 in fp16 plus a batch of this many ~900-token chunks.
EMBEDDING_BATCH_SIZE = 128
LOCAL_BATCH_SIZE = int(os.getenv("LOCAL_BATCH_SIZE", "8"))

# How much of a passage the reranker reads. The model accepts 8192 tokens, but
# pairs in a batch pad to the longest one, and chunks target 650 tokens with a
# tail running to 15,000 characters. Left uncapped, one long chunk in a batch
# allocated 1.37 GiB and took the service down. See rerank_local.
RERANK_MAX_TOKENS = int(os.getenv("RERANK_MAX_TOKENS", "1024"))

RAW_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
