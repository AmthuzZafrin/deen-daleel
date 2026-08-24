"""Database access for the ingestion pipelines.

Everything here is idempotent: re-running a pipeline updates rows in place
rather than duplicating them, so a crashed or partial run can simply be run
again.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Sequence

import psycopg

from config import DATABASE_URL, EMBEDDING_DIM


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    with psycopg.connect(DATABASE_URL) as conn:
        yield conn


def to_vector_literal(values: Sequence[float]) -> str:
    """Render a float sequence as a pgvector literal.

    Passed as text and cast with `%s::vector` on the way in, which avoids taking
    a dependency on the pgvector Python adapter for what is a one-line encoding.
    """
    if len(values) != EMBEDDING_DIM:
        raise ValueError(
            f"expected {EMBEDDING_DIM}-dim embedding, got {len(values)}. "
            "The vector column width and the embedding model must agree."
        )
    return "[" + ",".join(f"{v:.7g}" for v in values) + "]"


@dataclass(slots=True)
class Source:
    id: str
    kind: str  # quran | hadith | tafsir | fiqh
    title: str
    language: str
    license: str
    author: str | None = None
    madhhab: str | None = None
    attribution: str | None = None
    base_url: str | None = None


@dataclass(slots=True)
class Document:
    source_id: str
    canonical_ref: str
    ordinal: int
    arabic_text: str | None = None
    english_text: str | None = None
    permalink: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Chunk:
    """One retrievable span. `embedding` is filled in after the text is built."""

    ordinal: int
    content: str
    text_en: str = ""
    text_ar_norm: str = ""
    token_count: int = 0
    embedding: list[float] | None = None
    # The printed location of this span — 'Al-Mughni 3:214'. A document is a
    # whole volume, so the page can only be recorded here. Left empty where the
    # document's own ref is already exact, as it is for an ayah.
    canonical_ref: str = ""
    # What actually gets embedded: `content` with the Arabic diacritics folded
    # away. Measured on BGE-M3, folding lifts a relevant Arabic query from 0.411
    # to 0.576 cosine and simultaneously *lowers* an irrelevant one — the
    # vocalisation marks carry no retrieval signal and crowd the token budget.
    #
    # `content` itself stays fully vocalised: it is what the reader sees and
    # what citation spans point into, and a stripped Qur'an would be wrong to
    # display. Only the search projection is folded, exactly as `text_ar_norm`
    # already is for the trigram arm.
    embed_text: str = ""


def upsert_source(conn: psycopg.Connection, source: Source) -> None:
    conn.execute(
        """
        insert into sources (id, kind, title, author, madhhab, language,
                             license, attribution, base_url)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (id) do update set
            kind        = excluded.kind,
            title       = excluded.title,
            author      = excluded.author,
            madhhab     = excluded.madhhab,
            language    = excluded.language,
            license     = excluded.license,
            attribution = excluded.attribution,
            base_url    = excluded.base_url
        """,
        (
            source.id,
            source.kind,
            source.title,
            source.author,
            source.madhhab,
            source.language,
            source.license,
            source.attribution,
            source.base_url,
        ),
    )


def upsert_document(conn: psycopg.Connection, doc: Document) -> int:
    """Insert or update a document, returning its id.

    Keyed on (source_id, canonical_ref) — the natural identity of an ayah or a
    hadith — so a re-run never creates a second copy.
    """
    row = conn.execute(
        """
        insert into documents (source_id, canonical_ref, ordinal, arabic_text,
                               english_text, permalink, metadata)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (source_id, canonical_ref) do update set
            ordinal      = excluded.ordinal,
            arabic_text  = excluded.arabic_text,
            english_text = excluded.english_text,
            permalink    = excluded.permalink,
            metadata     = excluded.metadata
        returning id
        """,
        (
            doc.source_id,
            doc.canonical_ref,
            doc.ordinal,
            doc.arabic_text,
            doc.english_text,
            doc.permalink,
            json.dumps(doc.metadata, ensure_ascii=False),
        ),
    ).fetchone()
    assert row is not None
    return row[0]


def replace_chunks(
    conn: psycopg.Connection,
    document_id: int,
    source_id: str,
    kind: str,
    chunks: Iterable[Chunk],
) -> int:
    """Replace all chunks for a document.

    Delete-then-insert rather than upsert-by-ordinal: if a chunking strategy
    changes and a document now yields fewer chunks, the leftovers must not
    survive as orphans that retrieval could still surface.
    """
    chunks = list(chunks)
    for c in chunks:
        if c.embedding is None:
            raise ValueError(f"chunk {document_id}/{c.ordinal} has no embedding")

    conn.execute("delete from chunks where document_id = %s", (document_id,))
    with conn.cursor() as cur:
        cur.executemany(
            """
            insert into chunks (document_id, source_id, kind, ordinal, content,
                                text_en, text_ar_norm, embedding, token_count,
                                canonical_ref)
            values (%s, %s, %s, %s, %s, %s, %s, %s::vector, %s, %s)
            """,
            [
                (
                    document_id,
                    source_id,
                    kind,
                    c.ordinal,
                    c.content,
                    c.text_en,
                    c.text_ar_norm,
                    to_vector_literal(c.embedding),  # type: ignore[arg-type]
                    c.token_count,
                    c.canonical_ref,
                )
                for c in chunks
            ],
        )
    return len(chunks)


def corpus_stats(conn: psycopg.Connection) -> list[tuple[str, str, int, int]]:
    """(source_id, kind, document count, chunk count) for a post-run sanity check."""
    return conn.execute(
        """
        select s.id, s.kind,
               count(distinct d.id)::int as documents,
               count(c.id)::int          as chunks
        from sources s
        left join documents d on d.source_id = s.id
        left join chunks    c on c.document_id = d.id
        group by s.id, s.kind
        order by s.id
        """
    ).fetchall()
