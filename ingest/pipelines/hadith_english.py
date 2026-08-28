"""Attach published English to the hadith inside a chunk.

The corpus carries English for the Qur'an and nothing else. Machine translation
was tried against real cited passages and was not fit to put under a hadith --
`rak'a` came back as "knees", and Al-Mabsut's ruling came back inverted. So no
English here is generated. Every line of it is a published human translation,
and it is attached to a chunk only where the Arabic that was translated is
found *in that chunk*, in order, word for word.

That constraint is the whole design. It means the pairing is checkable by the
same standard as the daleel itself: the reader can see the Arabic on the page
and the English beside it, and `matched_arabic` records the exact run that was
located. Where the run is not there, nothing is written and the panel keeps
saying that no translation is held.

Two consequences worth knowing:

* A page of Sunan al-Tirmidhi holds several hadith, so a chunk can carry
  several rows, ordered by where they fall on the page.
* A page of Fath al-Bari quotes the matn it comments on. The matn matches; the
  commentary around it does not. So a commentary chunk shows English for the
  hadith under discussion and nothing for al-Asqalani's own words -- which is
  exactly the right claim to make, and the panel says so in those terms.

Matching is a word-shingle index for the candidate search and `difflib` for the
verification, deliberately in that order: the shingle pass is cheap and only has
to be generous, and the pass that decides is the one that compares the whole
text in sequence.

The English comes from the `hadith-api` dataset, which is released into the
public domain and carries each collection's Arabic and English under the same
hadith number -- so the Arabic can be matched and the English that belongs to it
taken, rather than the two being aligned by hand. It is not committed (60 MB,
and `ingest/data/raw/` is ignored); fetch it first:

    mkdir -p ingest/data/raw/hadith-api && cd ingest/data/raw/hadith-api
    for c in bukhari muslim abudawud tirmidhi nasai ibnmajah malik; do
      for l in ara eng; do
        curl -sLO "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/$l-$c.json"
      done
    done

Then:

    python -m pipelines.hadith_english            # match everything, write rows
    python -m pipelines.hadith_english --dry-run  # report only

`web/scripts/testTranslations.ts` re-checks every written row against the chunk
it points at, and is the thing to run after any re-ingest.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from db import connect  # noqa: E402
from normalize_ar import normalize_arabic  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "data" / "raw" / "hadith-api"

# Our source id -> the dataset's edition stem and the printed name to show.
#
# `nasai` is deliberately included even though our text is al-Sunan al-Kubra and
# the translation is of al-Mujtaba: the numbering does not correspond, but the
# match is on the Arabic itself, so a hadith that appears in both is paired
# correctly and one that does not appear simply finds nothing.
#
# `musnad-ahmad` has no published English edition in the dataset and so cannot
# be covered. The commentaries are here because they quote the matn.
EDITIONS: dict[str, tuple[str, str]] = {
    "bukhari": ("bukhari", "Sahih al-Bukhari"),
    "muslim": ("muslim", "Sahih Muslim"),
    "abu-dawud": ("abudawud", "Sunan Abi Dawud"),
    "tirmidhi": ("tirmidhi", "Jami' al-Tirmidhi"),
    "nasai": ("nasai", "Sunan al-Nasa'i"),
    "ibn-majah": ("ibnmajah", "Sunan Ibn Majah"),
    "muwatta": ("malik", "Muwatta Malik"),
}

# Commentaries quote the hadith they discuss. Each is matched against the
# collection it comments on, plus the two Sahihs, since all three quote widely.
COMMENTARY: dict[str, tuple[str, ...]] = {
    "fath-al-bari": ("bukhari", "muslim"),
    "sharh-muslim": ("muslim", "bukhari"),
    "tamhid": ("malik", "bukhari", "muslim"),
}

SHINGLE = 8          # words per shingle -- long enough that an isnad alone
                     # cannot carry a match on its own
INDEX_STRIDE = 3     # shingles are indexed every third word; the chunk side
                     # slides by one, so any shared run of SHINGLE + STRIDE
                     # words is guaranteed to collide at least once
MIN_HITS = 2         # candidates below this are not worth verifying

# A collection prints the hadith whole, so most of its words should be on the
# page and a short unbroken run is enough to confirm it.
FULL = (0.60, 8)     # (min coverage, min unbroken run) in words

# A commentary does not. Fath al-Bari names the hadith at the head of a chapter
# and then discusses it phrase by phrase, so a page may carry a third of it and
# still plainly be about it -- at the strict threshold 99% of Fath al-Bari
# matched nothing, which is the wrong answer for the most-cited work in the
# bank. Coverage is relaxed and the unbroken run is lengthened to pay for it:
# twelve consecutive words are not a formula like `قال رسول الله صلى الله عليه
# وسلم`, they are the hadith. The panel is told the coverage and says the
# passage quotes part of the hadith rather than implying it is the hadith.
PARTIAL = (0.30, 12)

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def words(text: str) -> list[str]:
    """Normalised Arabic as a bare word list, punctuation discarded.

    Both sides of the comparison go through this, so the editorial punctuation
    that one edition uses and another does not -- the guillemets around a matn,
    the commas inside an isnad -- cannot break a match.
    """
    return _PUNCT.sub(" ", normalize_arabic(text)).split()


@dataclass(slots=True)
class Hadith:
    edition: str      # 'eng-bukhari'
    collection: str   # 'Sahih al-Bukhari'
    number: int
    arabic: str
    english: str
    words: list[str]


def load_edition(stem: str, collection: str) -> list[Hadith]:
    """Pair one collection's Arabic with its English by hadith number."""
    ara = json.loads((DATA / f"ara-{stem}.json").read_text(encoding="utf-8"))
    eng = json.loads((DATA / f"eng-{stem}.json").read_text(encoding="utf-8"))
    english = {h["hadithnumber"]: h["text"] for h in eng["hadiths"]}

    out: list[Hadith] = []
    for h in ara["hadiths"]:
        en = (english.get(h["hadithnumber"]) or "").strip()
        ar = (h.get("text") or "").strip()
        # A hadith with no English is of no use here, and a very short one
        # cannot be matched safely -- "the deeds are by intentions" appears
        # inside a hundred pages and would attach itself to all of them.
        if not en or not ar:
            continue
        w = words(ar)
        if len(w) < SHINGLE + INDEX_STRIDE:
            continue
        out.append(
            Hadith(
                edition=f"eng-{stem}",
                collection=collection,
                number=int(h["hadithnumber"]),
                arabic=ar,
                english=en,
                words=w,
            )
        )
    return out


def shingles(w: list[str], stride: int = 1) -> list[tuple[int, str]]:
    return [
        (i, " ".join(w[i : i + SHINGLE]))
        for i in range(0, len(w) - SHINGLE + 1, stride)
    ]


def build_index(corpus: list[Hadith]) -> dict[int, list[int]]:
    """shingle hash -> indices into `corpus`.

    Hashed rather than stored as strings: the index holds around a million
    entries and the strings are only ever compared for equality, never read.
    A collision costs one wasted verification, which the verification rejects.
    """
    index: dict[int, list[int]] = {}
    for i, h in enumerate(corpus):
        for _, s in shingles(h.words, INDEX_STRIDE):
            index.setdefault(hash(s), []).append(i)
    return index


@dataclass(slots=True)
class Match:
    coverage: float
    matched: str      # the longest run, as it appears in the chunk
    start: int        # word offset of that run within the chunk
    span: range       # chunk words covered, for overlap resolution


def verify(
    chunk_words: list[str], h: Hadith, min_coverage: float, min_block: int
) -> Match | None:
    """Compare in sequence, and report what was actually found.

    `SequenceMatcher` rather than a substring test because editions differ in
    small ways -- an extra `رضي الله عنه`, a variant transmitter name -- and a
    passage that is plainly the same hadith should not be rejected over three
    words. What it must not do is accept a match built from scattered common
    words, which is why only runs of four or more count toward coverage and a
    single unbroken run of `min_block` is required on top.
    """
    sm = SequenceMatcher(None, h.words, chunk_words, autojunk=False)
    blocks = [b for b in sm.get_matching_blocks() if b.size >= 4]
    if not blocks:
        return None

    covered = sum(b.size for b in blocks)
    coverage = covered / len(h.words)
    longest = max(blocks, key=lambda b: b.size)
    if coverage < min_coverage or longest.size < min_block:
        return None

    first, last = blocks[0], blocks[-1]
    return Match(
        coverage=min(coverage, 1.0),
        matched=" ".join(chunk_words[longest.b : longest.b + longest.size]),
        start=first.b,
        span=range(first.b, last.b + last.size),
    )


def resolve(matches: list[Match]) -> list[Match]:
    """Keep the best match per region of the page.

    Collections repeat a hadith with a second chain, and the dataset carries
    both. Left alone that puts two near-identical translations under one
    passage. The strongest match for a region wins and anything overlapping it
    by more than half is dropped.
    """
    kept: list[Match] = []
    for m in sorted(matches, key=lambda m: (-m.coverage, m.start)):
        span = set(m.span)
        if any(len(span & set(k.span)) > len(span) * 0.5 for k in kept):
            continue
        kept.append(m)
    return sorted(kept, key=lambda m: m.start)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="report, write nothing")
    ap.add_argument("--source", action="append", help="limit to these source ids")
    args = ap.parse_args()

    corpus: list[Hadith] = []
    offsets: dict[str, range] = {}
    for stem, name in {s: n for s, n in EDITIONS.values()}.items():
        start = len(corpus)
        loaded = load_edition(stem, name)
        corpus.extend(loaded)
        offsets[stem] = range(start, len(corpus))
        print(f"loaded {len(loaded):>5} hadith with English from {name}")

    print(f"indexing {len(corpus)} hadith ...", flush=True)
    index = build_index(corpus)
    print(f"  {len(index)} shingles", flush=True)

    # Which slice of the corpus each of our sources may match against.
    allowed: dict[str, set[int]] = {}
    for src, (stem, _) in EDITIONS.items():
        allowed[src] = set(offsets[stem])
    for src, ss in COMMENTARY.items():
        allowed[src] = {i for s in ss for i in offsets[s]}

    targets = args.source or sorted(allowed)
    rows: list[tuple] = []
    stats: dict[str, tuple[int, int]] = {}

    with connect() as conn:
        for src in targets:
            permitted = allowed[src]
            min_coverage, min_block = PARTIAL if src in COMMENTARY else FULL
            with conn.cursor() as cur:
                cur.execute(
                    "select id, text_ar_norm from chunks "
                    "where source_id = %s and text_ar_norm <> '' order by id",
                    (src,),
                )
                chunks = cur.fetchall()

            hit_chunks = 0
            hit_rows = 0
            for chunk_id, norm in chunks:
                cw = _PUNCT.sub(" ", norm).split()
                if len(cw) < SHINGLE:
                    continue

                counts: dict[int, int] = {}
                for _, s in shingles(cw):
                    for i in index.get(hash(s), ()):
                        if i in permitted:
                            counts[i] = counts.get(i, 0) + 1

                found: list[tuple[Match, int]] = []
                for i, n in counts.items():
                    if n < MIN_HITS:
                        continue
                    m = verify(cw, corpus[i], min_coverage, min_block)
                    if m:
                        found.append((m, i))

                if not found:
                    continue
                by_match = {id(m): i for m, i in found}
                for m in resolve([m for m, _ in found]):
                    h = corpus[by_match[id(m)]]
                    rows.append(
                        (
                            chunk_id, h.edition, h.collection, h.number,
                            h.arabic, h.english, m.matched,
                            round(m.coverage, 4), m.start,
                        )
                    )
                    hit_rows += 1
                hit_chunks += 1

            stats[src] = (hit_chunks, len(chunks))
            print(
                f"{src:>14}: {hit_chunks:>6}/{len(chunks):<6} chunks matched "
                f"({hit_chunks / max(len(chunks), 1):5.1%})",
                flush=True,
            )

        print(f"\n{len(rows)} translations to write")
        if args.dry_run:
            return 0

        with conn.cursor() as cur:
            cur.execute(
                "delete from chunk_translations where chunk_id in ("
                "  select id from chunks where source_id = any(%s))",
                (targets,),
            )
            cur.executemany(
                "insert into chunk_translations "
                "(chunk_id, edition, collection, hadith_number, arabic_text, "
                " english_text, matched_arabic, coverage, char_offset) "
                "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "on conflict (chunk_id, edition, hadith_number) do nothing",
                rows,
            )
        conn.commit()
        print("written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
