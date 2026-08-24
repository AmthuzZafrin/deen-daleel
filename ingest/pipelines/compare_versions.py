"""Compare OpenITI versions of the same work by how well they can be cited.

OpenITI usually holds several digitisations of a text, and they differ a lot in
pagination quality — some mark nearly every page as `PageV00P000`, which yields
no citable location at all. The largest version is not the best one: the Muwatta
version with the most tokens could cite nothing, while a smaller one paginated
a third of its text.

Since a page reference is what makes a citation checkable, this picks versions on
that basis rather than on size.

**Read the percentage as a floor, not a forecast.** It counts *blocks* carrying a
page marker, while what ships is *chunks*, and a chunk packs many blocks together
and needs only one of them to be marked to be citable. Measured on the real
corpus, chunk-level coverage runs far above this number: Tafsir al-Jalalayn
scores 14.4% here and lands at 89%; Al-Majmu' scores 39.8% and lands at 93%.
So use this to rank versions of the same work against each other — that is what
it is good at — and take the coverage line printed by `pipelines.classical`,
which counts chunks, as the figure that describes what a reader will see.

    .venv/bin/python -m pipelines.compare_versions 0179MalikIbnAnas.Muwatta
    .venv/bin/python -m pipelines.compare_versions --book muwatta

Downloads each candidate once and caches it, so re-running is free.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx  # noqa: E402

from config import INGEST_DIR, ROOT  # noqa: E402
from parsers.markdown import parse_markdown  # noqa: E402
from sources import openiti  # noqa: E402

METADATA_URL = (
    "https://raw.githubusercontent.com/OpenITI/kitab-metadata-automation/"
    "master/output/OpenITI_RELEASE_git_RELEASE_data_metadata_light.csv"
)
METADATA_CACHE = INGEST_DIR / ".cache" / "openiti_metadata.tsv"


def load_metadata() -> list[dict]:
    if not METADATA_CACHE.exists():
        METADATA_CACHE.parent.mkdir(parents=True, exist_ok=True)
        print("fetching OpenITI metadata ...", flush=True)
        resp = httpx.get(METADATA_URL, follow_redirects=True, timeout=180)
        resp.raise_for_status()
        METADATA_CACHE.write_text(resp.text, encoding="utf-8")
    with METADATA_CACHE.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def book_uri_from_manifest(book_id: str) -> str:
    import yaml

    data = yaml.safe_load((ROOT / "content" / "corpus.yaml").read_text("utf-8"))
    for book in data.get("books", []):
        if book.get("id") == book_id:
            uri = book.get("uri", "")
            # Trim the version suffix to get the book prefix.
            return ".".join(uri.split(".")[:2])
    raise SystemExit(f"no manifest entry with id {book_id!r}")


def score(uri: str) -> tuple[int, float, str]:
    """Return (blocks, percent of blocks carrying a real page, note)."""
    try:
        raw = openiti.fetch(uri)
    except Exception as exc:  # noqa: BLE001
        return 0, 0.0, f"unavailable ({type(exc).__name__})"

    book = parse_markdown(raw)
    if not book.blocks:
        return 0, 0.0, "parsed to nothing"
    paged = sum(1 for b in book.blocks if b.page is not None)
    return len(book.blocks), 100 * paged / len(book.blocks), ""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("prefix", nargs="?", help="book prefix, e.g. 0179MalikIbnAnas.Muwatta")
    ap.add_argument("--book", help="manifest id to look up instead")
    ap.add_argument("--limit", type=int, default=6, help="candidates to try")
    args = ap.parse_args()

    prefix = args.prefix or (book_uri_from_manifest(args.book) if args.book else None)
    if not prefix:
        raise SystemExit("give a book prefix or --book <manifest id>")

    rows = [
        r
        for r in load_metadata()
        if r["versionUri"].lower().startswith(prefix.lower())
        and r["tok_length"].isdigit()
    ]
    if not rows:
        raise SystemExit(f"no OpenITI versions matching {prefix!r}")

    rows.sort(key=lambda r: -int(r["tok_length"]))
    rows = rows[: args.limit]

    print(f"\n{len(rows)} version(s) of {prefix}\n")
    print(f"{'tokens':>8s} {'blocks':>8s} {'paged':>7s}  versionUri")
    results = []
    for row in rows:
        blocks, pct, note = score(row["versionUri"])
        results.append((pct, blocks, row))
        tokens = int(row["tok_length"]) / 1e6
        shown = note if note else f"{pct:6.1f}%"
        print(f"{tokens:7.2f}M {blocks:8d} {shown:>7s}  {row['versionUri']}")

    best = max(results, key=lambda r: (r[0], r[1]))
    if best[0] > 0:
        print(f"\nbest pagination: {best[2]['versionUri']}  ({best[0]:.1f}%)")
    else:
        print("\nno version carries usable page markers")


if __name__ == "__main__":
    main()
