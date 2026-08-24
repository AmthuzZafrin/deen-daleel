"""Look for source markup that survived parsing and reached the text.

Run this after any change to `parsers/markdown.py`, and whenever a work is added
to the manifest.

    .venv/bin/python -m pipelines.audit_text                # every work
    .venv/bin/python -m pipelines.audit_text --book muslim  # one
    .venv/bin/python -m pipelines.audit_text --max 500      # fail above a budget

Why this exists
---------------
These are Arabic works, so any run of Latin letters or markup punctuation left
in their text is almost certainly something the parser should have consumed.
That single observation found, in one pass, four classes of contamination that
had survived every other check:

  * 97,128 chunks carrying OpenITI's `ms###` word-count milestones, seeded
    mid-sentence and shown to readers inside quoted scripture
  * 4,434 blocks of Sunan Abi Dawud that were nothing but
    `<div dir="rtl" id="book-container">` — a quarter of the work
  * 6,329 blocks of Sahih Muslim keeping a literal `### $` hadith marker
  * 820 footnote rules in Tafsir al-Jalalayn

None of them failed anything. The pipeline reported success, the citations
resolved, the pagination was perfect, and the text was wrong. Nothing about
markup leaking into scripture announces itself, which is exactly why it needs a
test that goes looking.

It reads from the download cache, so re-running costs nothing and it can run
alongside an ingest — it never touches the GPU or the database.
"""

from __future__ import annotations

import argparse
import collections
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import yaml  # noqa: E402

from config import ROOT  # noqa: E402
from parsers.markdown import parse_markdown  # noqa: E402
from sources import openiti  # noqa: E402

# Latin letters and the punctuation used by markup languages. Arabic prose does
# not contain these; a hit is a marker the parser failed to strip. Two or more
# characters, so a stray initial or a digit-and-letter reference is not noise.
SUSPECT = re.compile(r"[A-Za-z@#~%$^&*_|\\]{2,}")

# Shown in full rather than truncated: the point is to recognise the marker.
CONTEXT = 90


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--book", help="manifest id, default all")
    ap.add_argument(
        "--max",
        type=int,
        help="exit non-zero if occurrences exceed this, for use as a check",
    )
    ap.add_argument("--show", type=int, default=15, help="distinct artifacts to list")
    args = ap.parse_args()

    manifest = yaml.safe_load((ROOT / "content" / "corpus.yaml").read_text("utf-8"))
    books = [b for b in manifest.get("books", []) if not b.get("skip")]
    if args.book:
        books = [b for b in books if b["id"] == args.book]
        if not books:
            raise SystemExit(f"no manifest entry with id {args.book!r}")

    counts: collections.Counter[str] = collections.Counter()
    where: dict[str, tuple[str, str]] = {}
    by_book: collections.Counter[str] = collections.Counter()
    blocks_total = paged_total = 0

    for book in books:
        # The Qur'an comes from a different pipeline and is English-bearing, so
        # Latin text there is the translation, not markup.
        if book.get("kind") == "quran":
            continue
        try:
            parsed = parse_markdown(openiti.fetch(book["uri"]))
        except Exception as exc:  # noqa: BLE001
            print(f"  {book['id']}: unavailable ({type(exc).__name__})")
            continue

        blocks_total += len(parsed.blocks)
        paged_total += sum(1 for b in parsed.blocks if b.page is not None)

        for block in parsed.blocks:
            for hit in SUSPECT.findall(block.text):
                key = hit.lower()
                counts[key] += 1
                by_book[book["id"]] += 1
                where.setdefault(key, (book["id"], block.text[:CONTEXT]))

    if blocks_total == 0:
        raise SystemExit("nothing parsed")

    total = sum(counts.values())
    print(f"\n{blocks_total:,} blocks across {len(books)} work(s)")
    print(f"{paged_total:,} carry a page ({100 * paged_total / blocks_total:.0f}%)")
    print(f"{total:,} markup artifacts, {len(counts)} distinct\n")

    if counts:
        print(f"{'count':>8s}  artifact")
        for token, n in counts.most_common(args.show):
            book_id, sample = where[token]
            print(f"{n:8d}  {token!r}  ({book_id})")
            print(f"          {sample}")
        if by_book:
            print("\nworst affected:")
            for book_id, n in by_book.most_common(5):
                print(f"  {n:7d}  {book_id}")

    if args.max is not None and total > args.max:
        raise SystemExit(f"\n{total} artifacts exceeds the budget of {args.max}")


if __name__ == "__main__":
    main()
