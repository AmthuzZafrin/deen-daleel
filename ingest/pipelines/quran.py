"""Qur'an ingestion: Arabic text + a public-domain English translation.

Licensing
---------
Arabic is the Tanzil Uthmani text (free to redistribute unmodified, with
attribution). The default English is Pickthall (published 1930, author died
1936) which is public domain worldwide. Yusuf Ali is a second clean option.

Several widely-mirrored modern translations are *not* redistributable; they are
deliberately not defaults here. `sources.license` is NOT NULL precisely so this
decision has to be made before anything reaches the database.

Usage
-----
    python -m pipelines.quran --offline           # no API key, placeholder vectors
    python -m pipelines.quran --limit 20          # first 20 surahs
    python -m pipelines.quran                     # full corpus, real embeddings
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chunking import chunk_ayah  # noqa: E402
from config import RAW_DIR  # noqa: E402
from db import Document, Source, connect, corpus_stats, replace_chunks, upsert_document, upsert_source  # noqa: E402
from embed import embed_texts  # noqa: E402

API = "https://api.alquran.cloud/v1/quran"

ARABIC_EDITION = "quran-uthmani"
TRANSLATIONS = {
    "en.pickthall": {
        "source_id": "quran-en-pickthall",
        "title": "The Meaning of the Glorious Koran",
        "author": "Marmaduke Pickthall",
        "license": "public-domain",
        "attribution": "Marmaduke Pickthall (1930), public domain",
    },
    "en.yusufali": {
        "source_id": "quran-en-yusufali",
        "title": "The Holy Qur'an: Text, Translation and Commentary",
        "author": "Abdullah Yusuf Ali",
        "license": "public-domain",
        "attribution": "Abdullah Yusuf Ali (1934), public domain",
    },
}


def fetch_edition(edition: str) -> dict:
    """Download one full edition, caching the raw JSON under ingest/data/raw/."""
    cache = RAW_DIR / f"quran-{edition}.json"
    if cache.exists():
        print(f"  using cached {cache.name}")
        return json.loads(cache.read_text(encoding="utf-8"))

    print(f"  downloading edition {edition} ...")
    resp = httpx.get(f"{API}/{edition}", timeout=180)
    resp.raise_for_status()
    data = resp.json()["data"]
    cache.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"  cached to {cache.name}")
    return data


def run(translation: str, limit: int | None, offline: bool) -> None:
    meta = TRANSLATIONS[translation]

    arabic = fetch_edition(ARABIC_EDITION)
    english = fetch_edition(translation)

    ar_surahs = arabic["surahs"]
    en_surahs = {s["number"]: s for s in english["surahs"]}
    if limit:
        ar_surahs = ar_surahs[:limit]

    # Flatten to a verse list first so every text is embedded in one batched
    # pass rather than one HTTP call per ayah.
    records: list[tuple[Document, str, str, str, int, int]] = []
    for surah in ar_surahs:
        num = surah["number"]
        name_en = surah["englishName"]
        en_ayahs = {a["numberInSurah"]: a for a in en_surahs[num]["ayahs"]}

        for ayah in surah["ayahs"]:
            n = ayah["numberInSurah"]
            ar_text = ayah["text"]
            en_text = en_ayahs.get(n, {}).get("text", "")
            ref = f"Qur'an {num}:{n}"

            doc = Document(
                source_id=meta["source_id"],
                canonical_ref=ref,
                ordinal=ayah["number"],  # global ayah index, 1..6236
                arabic_text=ar_text,
                english_text=en_text,
                permalink=f"https://quran.com/{num}/{n}",
                metadata={
                    "surah": num,
                    "surah_name_en": name_en,
                    "surah_name_ar": surah["name"],
                    "ayah": n,
                    "juz": ayah.get("juz"),
                    "page": ayah.get("page"),
                    "revelation_type": surah.get("revelationType"),
                    "translator": meta["author"],
                },
            )
            records.append((doc, ar_text, en_text, name_en, num, n))

    print(f"\nprepared {len(records)} ayat from {len(ar_surahs)} surahs")

    # Build chunk text before embedding: the vector must be of exactly the text
    # the model will later be shown and cite from.
    built: list[tuple[Document, list]] = []
    for doc, ar_text, en_text, name_en, num, n in records:
        chunks = chunk_ayah(
            canonical_ref=doc.canonical_ref,
            surah_name=name_en,
            surah_number=num,
            ayah_number=n,
            arabic=ar_text,
            english=en_text,
            translator=meta["author"],
        )
        built.append((doc, chunks))

    # Note: embed_text, not content — the folded projection. See db.Chunk.
    texts = [c.embed_text or c.content for _, chunks in built for c in chunks]
    print(f"embedding {len(texts)} chunks"
          f"{' (OFFLINE — placeholder vectors)' if offline else ''} ...")
    vectors = embed_texts(
        texts,
        input_type="document",
        offline=offline,
        checkpoint=None if offline else f"quran-{translation}",
    )

    it = iter(vectors)
    for _, chunks in built:
        for c in chunks:
            c.embedding = next(it)

    print("writing to postgres ...")
    with connect() as conn:
        upsert_source(
            conn,
            Source(
                id=meta["source_id"],
                kind="quran",
                title=meta["title"],
                author=meta["author"],
                language="ar-en",
                license=meta["license"],
                attribution=meta["attribution"],
                base_url="https://quran.com/{surah}/{ayah}",
            ),
        )

        written = 0
        for doc, chunks in built:
            doc_id = upsert_document(conn, doc)
            written += replace_chunks(conn, doc_id, doc.source_id, "quran", chunks)
        conn.commit()

    print(f"wrote {len(built)} documents / {written} chunks\n")
    print(f"{'source':<24} {'kind':<8} {'docs':>7} {'chunks':>8}")
    with connect() as conn:
        for sid, kind, docs, chs in corpus_stats(conn):
            print(f"{sid:<24} {kind:<8} {docs:>7} {chs:>8}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest the Qur'an into Deen & Daleel.")
    ap.add_argument("--translation", default="en.pickthall", choices=sorted(TRANSLATIONS))
    ap.add_argument("--limit", type=int, help="only the first N surahs (for testing)")
    ap.add_argument(
        "--offline",
        action="store_true",
        help="skip Voyage and use deterministic placeholder vectors. Exercises the "
             "pipeline without an API key; retrieval quality will be noise.",
    )
    args = ap.parse_args()
    run(args.translation, args.limit, args.offline)


if __name__ == "__main__":
    main()
