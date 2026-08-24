"""Ingest the classical Arabic library from OpenITI.

Reads `content/corpus.yaml`, fetches each work, parses its mARkdown, chunks it
along headings with page-accurate citations, embeds locally, and writes it to
Postgres.

Licensing
---------
Everything here is CC BY-NC-SA 4.0 — free, **non-commercial**, attribution
required. That obligation is carried into `sources.license` and
`sources.attribution` for every work, and shown to readers in the source panel.
Nothing enters the database without it, because the column is NOT NULL.

Grouping
--------
One `document` per (work, volume). A whole 24-volume tafsir as a single document
would make `documents.canonical_ref` useless, while one document per page would
produce tens of thousands of rows carrying no more information. The volume is
the natural physical unit, and the chunk's own ref still names the page.

Usage
-----
    python -m pipelines.classical --list             # what is in the manifest
    python -m pipelines.classical --book bukhari     # one work
    python -m pipelines.classical --kind hadith      # everything of a kind
    python -m pipelines.classical --limit-chunks 200 # a smoke test
    python -m pipelines.classical                    # the whole library
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chunking import chunk_classical  # noqa: E402
from config import ROOT  # noqa: E402
from db import (  # noqa: E402
    Document,
    Source,
    connect,
    corpus_stats,
    replace_chunks,
    upsert_document,
    upsert_source,
)
from embed import embed_texts  # noqa: E402
from parsers.markdown import parse_markdown  # noqa: E402
from sources import openiti  # noqa: E402

MANIFEST = ROOT / "content" / "corpus.yaml"
VALID_KINDS = {"quran", "hadith", "tafsir", "fiqh"}


def load_manifest() -> tuple[dict, list[dict]]:
    data = yaml.safe_load(MANIFEST.read_text(encoding="utf-8"))
    defaults = data.get("defaults", {}) or {}
    books = data.get("books", []) or []

    seen: set[str] = set()
    for book in books:
        for field_name in ("id", "title", "kind"):
            if not book.get(field_name):
                raise SystemExit(f"manifest entry missing {field_name!r}: {book}")
        if book["kind"] not in VALID_KINDS:
            raise SystemExit(
                f"{book['id']}: kind {book['kind']!r} is not one of {sorted(VALID_KINDS)}"
            )
        if book["id"] in seen:
            raise SystemExit(f"duplicate manifest id: {book['id']}")
        seen.add(book["id"])
        if not book.get("uri") and not book.get("path"):
            raise SystemExit(f"{book['id']}: needs either a uri or a local path")
    return defaults, books


def load_text(book: dict, refresh: bool) -> str:
    """Fetch from OpenITI, or read a local file for material we cannot host."""
    if book.get("path"):
        path = Path(book["path"])
        if not path.is_absolute():
            path = ROOT / path
        return path.read_text(encoding="utf-8")
    return openiti.fetch(book["uri"], refresh=refresh)


def ingest_book(conn, book: dict, defaults: dict, limit_chunks: int | None) -> int:
    label = book["title"]
    print(f"\n=== {label} ({book['id']}) ===", flush=True)

    raw = load_text(book, refresh=False)
    parsed = parse_markdown(raw)
    if not parsed.blocks:
        print("  no text parsed — skipping")
        return 0
    print(f"  parsed {len(parsed.blocks)} blocks")

    source = Source(
        id=book["id"],
        kind=book["kind"],
        title=label,
        author=book.get("author"),
        language=book.get("language", defaults.get("language", "ar")),
        license=book.get("license", defaults.get("license")),
        attribution=book.get("attribution", defaults.get("attribution")),
        base_url=parsed.permalink or None,
        madhhab=book.get("madhhab"),
    )
    if not source.license:
        raise SystemExit(f"{book['id']}: no licence — refusing to ingest")
    upsert_source(conn, source)

    pairs = chunk_classical(work_title=label, blocks=parsed.blocks)
    if limit_chunks:
        pairs = pairs[:limit_chunks]
    if not pairs:
        print("  no chunks produced — skipping")
        return 0

    # Report how much of the work can actually be cited to a page. Coverage
    # varies wildly between versions of the same text — some mark almost every
    # page as PageV00P000, which yields no citable location at all. Printing it
    # is what makes a badly paginated version visible instead of silently
    # producing chunks that cite nothing but the title.
    cited = sum(1 for _, ref in pairs if ":" in ref)
    pct = 100 * cited / len(pairs)
    note = "  <-- poor pagination, consider another version" if pct < 50 else ""
    print(f"  {len(pairs)} chunks | page citations on {pct:.0f}%{note}")

    # Group by volume: one document per physical volume of the printed edition.
    by_volume: dict[int | None, list] = defaultdict(list)
    for chunk, ref in pairs:
        by_volume[_volume_of(ref)].append((chunk, ref))

    texts = [c.embed_text or c.content for c, _ in pairs]
    print(f"  embedding {len(texts)} chunks ...", flush=True)
    vectors = embed_texts(
        texts, input_type="document", checkpoint=f"classical-{book['id']}"
    )
    vector_by_id = {id(c): v for (c, _), v in zip(pairs, vectors)}

    total = 0
    written: list[int] = []
    refs_seen: set[str] = set()
    for ordinal, (volume, items) in enumerate(sorted(
        by_volume.items(), key=lambda kv: (kv[0] is None, kv[0])
    )):
        ref = _volume_ref(label, volume)

        # Documents are keyed on (source_id, canonical_ref), so two buckets
        # rendering the same string do not collide loudly — the second upsert
        # returns the first's id and `replace_chunks` deletes its rows on the
        # way in. That silently destroyed 789 of Jalalayn's 886 chunks when
        # volume 0 and volume None both rendered as the bare title. Fail here
        # instead: losing data must not look like a successful run.
        if ref in refs_seen:
            raise ValueError(
                f"{book['id']}: two volume buckets both render as {ref!r}; "
                "the second would overwrite the first"
            )
        refs_seen.add(ref)

        doc = Document(
            source_id=book["id"],
            canonical_ref=ref,
            ordinal=ordinal,
            permalink=parsed.permalink or None,
            metadata={
                "volume": volume,
                "work_id": book["id"],
                "title_ar": book.get("title_ar"),
                "openiti_uri": book.get("uri"),
            },
        )
        document_id = upsert_document(conn, doc)
        written.append(document_id)

        chunks = []
        for i, (chunk, chunk_ref) in enumerate(items):
            chunk.ordinal = i
            chunk.embedding = vector_by_id[id(chunk)]
            # The page, kept on the chunk. The document above it can only name
            # the volume, so dropping this would leave every citation reading
            # 'vol. 3' — unusable for checking against a printed edition.
            chunk.canonical_ref = chunk_ref
            chunks.append(chunk)

        total += replace_chunks(conn, document_id, book["id"], book["kind"], chunks)

    # Documents this run did not produce are leftovers from an earlier parse or
    # an earlier version of the text. `replace_chunks` cannot reach them — it
    # only clears documents it rewrites — so they would survive as orphans and
    # keep serving superseded text under a citation nobody can reproduce.
    dropped = conn.execute(
        "delete from documents where source_id = %s and id <> all(%s)",
        (book["id"], written),
    ).rowcount
    if dropped:
        print(f"  removed {dropped} stale document(s) from a previous run")

    # Everything the chunker produced must be readable back. `total` counts what
    # the inserts claimed; this counts what survived them, which is the number
    # that differed when a document collision was quietly deleting rows. The
    # coverage line printed above describes `pairs`, so if the database holds
    # fewer, the reported figure is a fiction.
    stored = conn.execute(
        "select count(*) from chunks where source_id = %s", (book["id"],)
    ).fetchone()[0]
    if stored != len(pairs):
        raise ValueError(
            f"{book['id']}: chunked {len(pairs)} but stored {stored} — "
            "chunks were lost between chunking and the database"
        )

    print(f"  wrote {len(by_volume)} documents / {total} chunks")
    return total


def _volume_ref(label: str, volume: int | None) -> str:
    """Name the document for one volume bucket, distinctly in all three cases.

    `if volume` would be the obvious spelling and is wrong twice over: volume 0
    is a real location — OpenITI writes `PageV00P123` for a work printed as a
    single unnumbered volume — and it is falsy, so it would render identically
    to the bucket that carries no page marker at all. Those are different things
    and must not share a name.
    """
    if volume is None:
        return f"{label} (unpaginated)"
    if volume == 0:
        return label  # one unnumbered volume; 'vol. 0' would be an invention
    return f"{label} vol. {volume}"


def _volume_of(ref: str) -> int | None:
    """Pull the volume back out of a chunk ref like 'Al-Mabsut 3:114-115'."""
    tail = ref.rsplit(" ", 1)[-1]
    if ":" not in tail:
        return None
    head = tail.split(":", 1)[0]
    return int(head) if head.isdigit() else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", help="ingest a single manifest id")
    ap.add_argument("--kind", choices=sorted(VALID_KINDS), help="ingest one kind")
    ap.add_argument("--limit-chunks", type=int, help="cap chunks per book (smoke test)")
    ap.add_argument("--list", action="store_true", help="list the manifest and exit")
    args = ap.parse_args()

    defaults, books = load_manifest()

    if args.list:
        print(f"{'id':18s} {'kind':8s} title")
        for b in books:
            print(f"{b['id']:18s} {b['kind']:8s} {b['title']}")
        print(f"\n{len(books)} works")
        return

    if args.book:
        books = [b for b in books if b["id"] == args.book]
        if not books:
            raise SystemExit(f"no manifest entry with id {args.book!r}")
    if args.kind:
        books = [b for b in books if b["kind"] == args.kind]
        if not books:
            raise SystemExit(f"no manifest entries of kind {args.kind!r}")

    # A `skip:` in the manifest carries the editorial reason a work is held
    # back — usually pagination too poor to cite. Naming the book explicitly
    # overrides it, so the decision can be revisited without editing the file.
    if not args.book:
        for b in books:
            if b.get("skip"):
                print(f"skipping {b['id']}: {b['skip']}")
        books = [b for b in books if not b.get("skip")]

    print(f"ingesting {len(books)} work(s)")
    grand = 0
    failed: list[tuple[str, str]] = []

    with connect() as conn:
        for book in books:
            try:
                grand += ingest_book(conn, book, defaults, args.limit_chunks)
                conn.commit()
            except Exception as exc:  # noqa: BLE001
                # One unavailable text must not abandon the rest of the library.
                conn.rollback()
                print(f"  FAILED: {type(exc).__name__}: {exc}", flush=True)
                failed.append((book["id"], f"{type(exc).__name__}: {exc}"))

        print(f"\ntotal chunks written: {grand}")
        if failed:
            print(f"\n{len(failed)} work(s) failed:")
            for book_id, msg in failed:
                print(f"  {book_id}: {msg[:120]}")

        print()
        print(f"{'source':28s} {'kind':8s} {'docs':>7s} {'chunks':>8s}")
        for source_id, kind, docs, chunks in corpus_stats(conn):
            print(f"{source_id:28s} {kind:8s} {docs:7d} {chunks:8d}")


if __name__ == "__main__":
    main()
