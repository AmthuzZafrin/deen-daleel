"""Chunking strategies, one per source kind.

The governing rule is that a chunk should be a *citable unit of evidence*. An
ayah cut in half is not daleel, and neither is the second half of a hadith
without its narrator. So Qur'an and hadith are never split regardless of length,
while tafsir and fiqh — which are continuous prose with no natural atomic unit —
are packed to a token budget along paragraph boundaries.

Every chunk's text opens with its canonical reference, so the reference travels
into the model's context along with the content.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from db import Chunk
from embed import estimate_tokens
from normalize_ar import normalize_arabic

# Prose targets. Large enough to hold a complete argument, small enough that a
# dozen chunks still leave room for the answer within a comfortable budget.
PROSE_TARGET_TOKENS = 650
PROSE_MAX_TOKENS = 900
PROSE_OVERLAP_TOKENS = 100

# Measured on Tabari: classical Arabic runs about 1.7 BGE-M3 tokens per
# whitespace-delimited word. Used only by the last-resort hard wrap below.
_ARABIC_TOKEN_PER_WORD = 1.7


@dataclass(slots=True)
class ProseSection:
    """A heading-delimited span of a prose work (tafsir or fiqh)."""

    heading: str  # 'Book of Prayer › Chapter on Travel › Shortening'
    body: str


def _assemble(
    ref: str, header_extra: str, english: str, arabic: str, translator: str | None
) -> Chunk:
    """Build the exact text the model will read and cite from."""
    lines = [f"{ref}{header_extra}"]
    if english:
        label = f"Translation ({translator}):" if translator else "Text:"
        lines += ["", label, english.strip()]
    if arabic:
        lines += ["", "Arabic:", arabic.strip()]
    content = "\n".join(lines)

    # The embedding projection: same text, Arabic folded. Built here rather than
    # at the call site so every chunker gets it without having to remember.
    embed_lines = [f"{ref}{header_extra}"]
    if english:
        embed_lines += ["", english.strip()]
    if arabic:
        embed_lines += ["", normalize_arabic(arabic)]

    return Chunk(
        ordinal=0,
        content=content,
        text_en=english.strip(),
        text_ar_norm=normalize_arabic(arabic),
        token_count=estimate_tokens(content),
        embed_text="\n".join(embed_lines),
    )


def chunk_ayah(
    *,
    canonical_ref: str,
    surah_name: str,
    surah_number: int,
    ayah_number: int,
    arabic: str,
    english: str,
    translator: str,
) -> list[Chunk]:
    """One ayah, one chunk — never split, however long.

    Al-Baqarah 2:282 (the longest verse) still fits comfortably; splitting it
    would produce fragments that cannot stand as evidence on their own.
    """
    chunk = _assemble(
        ref=canonical_ref,
        header_extra=f" — Surah {surah_name}, verse {ayah_number} of chapter {surah_number}",
        english=english,
        arabic=arabic,
        translator=translator,
    )
    return [chunk]


def chunk_hadith(
    *,
    canonical_ref: str,
    collection: str,
    book: str | None,
    narrator: str | None,
    grading: str | None,
    arabic: str,
    english: str,
) -> list[Chunk]:
    """One narration, one chunk — never split.

    `grading` is included only when the source dataset actually supplies it.
    Asserting a grading we do not have would be worse than showing none: a user
    deciding to act on a hadith they believe is sahih is exactly the failure this
    app must not cause.
    """
    parts = []
    if book:
        parts.append(book)
    if narrator:
        parts.append(f"narrated by {narrator}")
    if grading:
        parts.append(f"grading: {grading}")
    extra = f" — {collection}" + (f" ({'; '.join(parts)})" if parts else "")

    return [_assemble(canonical_ref, extra, english, arabic, translator=None)]


def _split_paragraphs(text: str) -> list[str]:
    paras = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n")]
    return [p for p in paras if p]


# Sentence terminators, Latin and Arabic.
#
# Classical Arabic prose is punctuated sparsely and rarely with a full stop, so
# splitting on ". " alone leaves paragraphs of several thousand tokens intact —
# five times the intended maximum. The Arabic comma and semicolon are included
# because in this register they do the work a full stop does in English.
_SENTENCE_END = re.compile(r"(?<=[.؟!؛۔:])\s+|(?<=،)\s+")


def _split_oversized(paragraph: str) -> list[str]:
    """Break a single paragraph that alone exceeds the max, on sentence bounds."""
    if estimate_tokens(paragraph) <= PROSE_MAX_TOKENS:
        return [paragraph]

    pieces = _SENTENCE_END.split(paragraph)

    # Nothing to split on: a long unpunctuated run. Fall back to a hard wrap on
    # whitespace, because returning it whole would blow the context budget.
    if len(pieces) == 1:
        words = paragraph.split()
        approx = max(1, int(PROSE_TARGET_TOKENS / _ARABIC_TOKEN_PER_WORD))
        pieces = [
            " ".join(words[i : i + approx]) for i in range(0, len(words), approx)
        ]

    out: list[str] = []
    current: list[str] = []
    running = 0
    for sentence in pieces:
        sentence = sentence.strip()
        if not sentence:
            continue
        cost = estimate_tokens(sentence)
        if running + cost > PROSE_TARGET_TOKENS and current:
            out.append(" ".join(current))
            current, running = [], 0
        current.append(sentence)
        running += cost
    if current:
        out.append(" ".join(current))
    # Joined with a space, not ". ": the split keeps each terminator attached to
    # the sentence it ends, so adding another would punctuate the text twice.
    return out


def chunk_classical(
    *,
    work_title: str,
    blocks,
    source_label: str | None = None,
) -> list[tuple[Chunk, str]]:
    """Pack parsed mARkdown blocks into chunks, each carrying a page citation.

    Returns `(chunk, canonical_ref)` pairs, where the ref names the printed
    location — `Radd al-Muhtar 2:114` or `2:114-115` when a chunk spans a page
    turn. That reference is the entire reason for parsing page markers: it is
    what lets a reader, or their scholar, physically check the claim.

    These works are Arabic, so the body goes into the Arabic slot: the folded
    text feeds the trigram arm and the embedding, and `text_en` stays empty
    because there is no translation to search.

    Like `chunk_prose`, a chunk never spans a heading — a Hanafi section and the
    Shafi'i one after it must not merge into what reads as a single position.
    """
    out: list[tuple[Chunk, str]] = []

    current: list = []
    running = 0

    def flush() -> None:
        nonlocal current, running
        if not current:
            return

        body = "\n\n".join(b.text for b in current)
        # `is not None`, not truthiness: `PageV00P000` marks front matter, and
        # volume 0 page 0 is a real location rather than a missing one.
        pages = [b.page for b in current if b.page is not None]
        volume = next((b.volume for b in current if b.volume is not None), None)

        if pages and volume is not None:
            lo, hi = min(pages), max(pages)
            span = f"{volume}:{lo}" if lo == hi else f"{volume}:{lo}-{hi}"
            ref = f"{work_title} {span}"
        else:
            # No page marker reached this text. Better an honest reference to
            # the work than a fabricated page number.
            ref = work_title

        heading = current[0].heading
        chunk = _assemble(
            ref,
            f" — {heading}" if heading else "",
            english="",
            arabic=body,
            translator=source_label,
        )
        out.append((chunk, ref))
        current, running = [], 0

    for block in blocks:
        text = block.text.strip()
        if not text:
            continue

        # A heading change closes the chunk, whatever the budget says.
        if current and block.heading != current[0].heading:
            flush()

        for piece in _split_oversized(text):
            cost = estimate_tokens(piece)
            if running + cost > PROSE_TARGET_TOKENS and current:
                flush()
            # Rebuild the block around the split piece so page and heading ride
            # along with it.
            current.append(
                type(block)(
                    heading=block.heading,
                    text=piece,
                    volume=block.volume,
                    page=block.page,
                )
            )
            running += cost

    flush()

    for i, (chunk, _) in enumerate(out):
        chunk.ordinal = i
    return out


def chunk_prose(
    *,
    canonical_ref: str,
    sections: list[ProseSection],
    arabic: str = "",
    source_label: str | None = None,
) -> list[Chunk]:
    """Pack heading-delimited prose into overlapping, budget-sized chunks.

    Chunks never span a heading: a Hanafi section and the Shafi'i section that
    follows it must not end up in one chunk, or the retrieved evidence would
    silently blend two schools' positions into what looks like a single one.

    Overlap is carried within a section so a ruling split across a boundary is
    still recoverable from at least one chunk.
    """
    chunks: list[Chunk] = []

    for section in sections:
        units: list[str] = []
        for para in _split_paragraphs(section.body):
            units.extend(_split_oversized(para))

        buffer: list[str] = []
        running = 0

        def flush() -> None:
            nonlocal buffer, running
            if not buffer:
                return
            body = "\n\n".join(buffer)
            heading = f" — {section.heading}" if section.heading else ""
            chunks.append(
                _assemble(canonical_ref, heading, body, arabic, source_label)
            )
            # Carry the tail of this chunk into the next one.
            tail: list[str] = []
            carried = 0
            for unit in reversed(buffer):
                cost = estimate_tokens(unit)
                if carried + cost > PROSE_OVERLAP_TOKENS:
                    break
                tail.insert(0, unit)
                carried += cost
            buffer = tail
            running = carried

        for unit in units:
            cost = estimate_tokens(unit)
            if running + cost > PROSE_TARGET_TOKENS and buffer:
                flush()
            buffer.append(unit)
            running += cost

        # Final flush for the section, without carrying overlap forward.
        if buffer:
            body = "\n\n".join(buffer)
            heading = f" — {section.heading}" if section.heading else ""
            chunks.append(_assemble(canonical_ref, heading, body, arabic, source_label))
            buffer, running = [], 0

    for i, chunk in enumerate(chunks):
        chunk.ordinal = i
    return chunks
