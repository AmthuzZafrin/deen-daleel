"""Parser for OpenITI mARkdown, the format the classical corpus ships in.

The format is line-oriented and small:

    #META# 020.BookTITLE :: تفسير الطبري = جامع البيان ...
    #META# 031.LibREADONLINE :: http://shamela.ws/browse.php/book_7798
    #META#Header#End#

    ### |    مقدمة المصنف          ← heading, one to three levels
    بسم الله الرحمن الرحيم         ← body, hard-wrapped at ~60 chars
    PageV01P003                    ← page boundary

Two details drive the whole design:

**Page markers are the reason this is worth parsing properly.** `PageV01P003`
yields a real volume and page in a printed edition, so a fiqh citation becomes
something a reader or their scholar can physically check. Losing them would
reduce every citation to "somewhere in Radd al-Muhtar", which is not daleel.

A marker terminates the page it names: text *above* `PageV01P003` is page 3.

**Lines are hard-wrapped, not semantic.** A paragraph spans many lines and is
terminated by a blank one. Joining them back is required — otherwise the token
estimate is wrong and the text reads as fragments.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# `### |`, `### ||`, `### |||` — depth is the number of pipes. Some files also
# use a named form, `### |EDITOR|`, for front matter.
_HEADING = re.compile(r"^#{3,}\s*(\|+)\s*(.*)$")

# Paragraph markup, which differs between OpenITI file variants:
#
#   `# text`   begins a paragraph
#   `~~text`   continues the previous line within the same paragraph
#
# The `.mARkdownSimple` files have these stripped and use blank lines instead,
# so both conventions have to work. Missing them does not fail loudly: the
# markers simply end up in the text the reader sees, and an entire book collapses
# into one unsplit paragraph.
_PARA_START = re.compile(r"^#\s+(.*)$")
_CONTINUATION = re.compile(r"^~~\s?(.*)$")

# `### $` opens an entry rather than a section — a single hadith in a collection,
# a life in a biographical dictionary. It is a paragraph boundary, not a heading:
# promoting 6,329 narrations of Sahih Muslim to headings would replace the book
# and chapter breadcrumb with the first words of each hadith. Left unhandled it
# was worse still, since `### $ ` stayed at the front of the text itself.
_ENTRY_START = re.compile(r"^#{3,}\s*\$+\s*(.*)$")

# Some digitisations are converted from web pages and keep the markup. A quarter
# of Sunan Abi Dawud — 4,434 blocks — was nothing but
# `<div dir="rtl" id="book-container">`. Bounded length so a bare '<' in the text
# cannot swallow the rest of a line.
_HTML = re.compile(r"<[^<>\n]{1,300}>")

# OpenITI structural annotations: `@MATN@` for the body of a hadith, `@QUR@` for
# a Qur'anic quotation, and similar. The distinction they draw is real, but the
# tag is not part of the text.
_STRUCT_TAG = re.compile(r"@[A-Za-z]{2,12}@")

# A typographic rule, in any of the characters used for one.
_RULE = re.compile(r"^\s*[_\-=~]{4,}\s*$")

# Volume and page of a printed edition, in two forms.
#
# `PageV01P003` usually sits on its own line and ends a paragraph, while
# `PageEndV01P003` appears mid-sentence where a page turns inside one. But the
# distinction is not reliable: Tabari has 1,158 `PageV` markers inline and 234
# inside heading lines. So both spellings are handled in both positions, and
# headings are cleaned too — anything missed ends up displayed to the reader in
# the middle of quoted scripture.
_PAGE = re.compile(r"^\s*Page(?:End)?V(\d+)P(\d+)\s*$")
_PAGE_INLINE = re.compile(r"Page(?:End)?V(\d+)P(\d+)")


def _real_page(volume: int, page: int) -> bool:
    """False for `PageV00P000`, OpenITI's placeholder for unpaginated text.

    Some versions carry it for most of the book — 4,159 of the Muwatta's 4,575
    markers. Treating it as a location would produce citations reading
    "Al-Muwatta 0:0", which is a fabricated reference dressed as a real one.
    Better to cite the work alone and be honest that the page is unknown.
    """
    return not (volume == 0 and page == 0)

# `#META# key :: value`, and the sentinel that ends the header block.
_META = re.compile(r"^#META#\s*(.+?)\s*::\s*(.*)$")
_META_END = "#META#Header#End#"

# A line that is nothing but a rule. Only this may be dropped whole.
_NOISE = re.compile(r"^#####+\s*$")

# Marks that sit *inside* a line and must be removed from it rather than take
# the line with them.
#
# `%~%` separates the two hemistichs of a verse. It was previously treated as a
# whole-line drop, which discarded the poetry: 2,145 lines and 105,846
# characters of Tabari alone, silently, because the test was `search` on the
# line rather than a substitution within it.
#
# `ms###` is OpenITI's word-count milestone, seeded every N words with no
# regard for sense — it landed mid-sentence in 97,128 chunks, where it was
# shown to readers inside quoted scripture and embedded as though it were part
# of the text.
#
# `@QB@`/`@QE@` bracket a Qur'anic quotation. The bracketing is real structure
# but the tags are not words; they are dropped and the quotation left in place.
#
# The trailing pieces, each from a different digitisation:
#   `____`        a footnote rule, which in Tafsir al-Jalalayn ends a line of
#                 real text rather than standing alone, so the whole-line rule
#                 above never saw it
#   `^\|+`        a heading written with bare pipes and no `###`, as in Sunan
#                 al-Nasa'i. Arabic never opens a line with a pipe, so stripping
#                 it is safe even where it is not a heading.
#   `PageV0MP001` a page marker whose volume is not a number. `_PAGE_INLINE`
#                 requires digits and so cannot consume it; it must still not be
#                 shown to a reader. No page is recovered — there is none to
#                 recover — the marker is simply removed.
#
# That last pattern must match *only* the malformed form. This substitution runs
# before the page rules do, so a pattern loose enough to catch `PageV01P003`
# would silently delete every page marker in the corpus and take all pagination
# with it. It therefore requires a letter in the volume or the page.
_BAD_PAGE = r"Page(?:End)?V\d*[A-Za-z]\w*P\w+|Page(?:End)?V\d+P\w*[A-Za-z]\w*"

_INLINE_NOISE = re.compile(
    r"%~%|\bms\d+\b|@Q[BE]@|_{4,}|^\|+|"
    + _BAD_PAGE
    + "|"
    + _HTML.pattern
    + "|"
    + _STRUCT_TAG.pattern
)

# OpenITI writes "NODATA"/"NOTGIVEN" rather than omitting absent fields.
_ABSENT = {"NODATA", "NOTGIVEN", "NOCODE", ""}


@dataclass(slots=True)
class Block:
    """One paragraph, tagged with where it sits in the book."""

    heading: str  # 'Book of Prayer › Chapter on Travel'
    text: str
    volume: int | None = None
    page: int | None = None


@dataclass(slots=True)
class ParsedBook:
    meta: dict[str, str] = field(default_factory=dict)
    blocks: list[Block] = field(default_factory=list)

    @property
    def title(self) -> str:
        return self.meta.get("020.BookTITLE", "")

    @property
    def author(self) -> str:
        return self.meta.get("010.AuthorNAME", "")

    @property
    def permalink(self) -> str:
        """Where a reader can see this text online, when the header says."""
        for key in ("031.LibREADONLINE", "031.LibURL"):
            value = self.meta.get(key, "")
            if value:
                return value
        return ""


def _clean(value: str) -> str:
    return "" if value.strip() in _ABSENT else value.strip()


def parse_meta(lines: list[str]) -> tuple[dict[str, str], int]:
    """Read the `#META#` header. Returns the metadata and where the body starts."""
    meta: dict[str, str] = {}
    for i, line in enumerate(lines):
        if line.strip() == _META_END:
            return meta, i + 1
        match = _META.match(line)
        if match:
            value = _clean(match.group(2))
            if value:
                meta[match.group(1).strip()] = value

    # No sentinel: a few files omit it. Fall back to the last #META# line rather
    # than treating the whole book as a header.
    last = max(
        (i for i, ln in enumerate(lines) if ln.startswith("#META#")), default=-1
    )
    return meta, last + 1


def parse_markdown(text: str) -> ParsedBook:
    """Parse a full mARkdown file into metadata and page-tagged paragraphs."""
    lines = text.replace("\r\n", "\n").split("\n")
    meta, start = parse_meta(lines)

    book = ParsedBook(meta=meta)

    crumbs: list[str] = []  # heading stack, index = depth - 1
    pending: list[Block] = []  # blocks awaiting the page marker that ends them
    buffer: list[str] = []  # lines of the paragraph being read
    volume: int | None = None

    def flush_paragraph() -> None:
        """End the current paragraph and queue it for a page number.

        An inline `PageEndVxxPyyy` splits the paragraph there: the text before
        it belongs to that page and is emitted immediately with its number,
        while the remainder waits for whatever marker comes next.
        """
        nonlocal buffer, volume
        if not buffer:
            return
        body = " ".join(part.strip() for part in buffer if part.strip())
        buffer = []
        if not body:
            return

        parts = _PAGE_INLINE.split(body)
        # split() yields [text, vol, page, text, vol, page, ..., tail].
        # Everything goes through `pending` so document order is preserved —
        # already-numbered pieces simply arrive with their page already set.
        for i in range(0, len(parts) - 1, 3):
            head = parts[i].strip()
            vol, page = int(parts[i + 1]), int(parts[i + 2])
            real = _real_page(vol, page)
            if real:
                volume = vol
            if head:
                pending.append(Block(heading=" › ".join(crumbs), text=head))
            # An inline marker ends a page for everything still unnumbered, not
            # merely for the fragment beside it. Numbering only the fragment
            # leaves every earlier paragraph waiting for the next *standalone*
            # marker — and some versions barely use those: Majmu' al-Fatawa has
            # 16,809 inline markers against 45 standalone. The backlog then took
            # the number of a marker hundreds of pages later, and a chunk drawn
            # from it cited '32:135-215'. A span that wide is not a citation.
            if real:
                assign_page(vol, page)

        tail = parts[-1].strip()
        if tail:
            pending.append(Block(heading=" › ".join(crumbs), text=tail))

    def assign_page(vol: int, page: int) -> None:
        """Stamp everything still unnumbered since the last marker.

        Blocks that already carry a page came from an inline `PageEnd` and are
        left alone — their number is more precise than this one.
        """
        nonlocal pending
        for block in pending:
            if block.page is None:
                block.volume, block.page = vol, page
        book.blocks.extend(pending)
        pending = []

    for line in lines[start:]:
        if _NOISE.match(line) or _RULE.match(line):
            continue
        # Strip inline marks before anything else reads the line, so page and
        # heading matching see the text a reader would.
        if _INLINE_NOISE.search(line):
            line = _INLINE_NOISE.sub(" ", line)
            if not line.strip():
                continue

        page_match = _PAGE.match(line)
        if page_match:
            flush_paragraph()
            vol, page = int(page_match.group(1)), int(page_match.group(2))
            if _real_page(vol, page):
                volume = vol
                assign_page(vol, page)
            continue

        # Before the heading rule, since both open with `###`. An entry keeps
        # the surrounding breadcrumb and starts a new paragraph under it.
        entry_match = _ENTRY_START.match(line)
        if entry_match:
            flush_paragraph()
            body = entry_match.group(1).strip()
            if body:
                buffer.append(body)
            continue

        heading_match = _HEADING.match(line)
        if heading_match:
            flush_paragraph()
            depth = len(heading_match.group(1))
            # A heading can carry a page marker too. Take the number if it is
            # the first sighting, but never let it into the breadcrumb, which
            # is prepended to every chunk's text.
            title = heading_match.group(2)
            for vol_s, page_s in _PAGE_INLINE.findall(title):
                vol, page = int(vol_s), int(page_s)
                if not _real_page(vol, page):
                    continue
                volume = vol
                if pending and pending[-1].page is None:
                    assign_page(vol, page)
            # `### |EDITOR|` leaves a trailing pipe on the captured title.
            title = _PAGE_INLINE.sub(" ", title).strip().strip("|").strip()
            # Truncate the stack to this depth, then set the current level, so
            # a level-2 heading replaces the previous level-2 and drops any
            # level-3 beneath it.
            del crumbs[depth - 1 :]
            if title:
                crumbs.append(title)
            continue

        if not line.strip():
            flush_paragraph()
            continue

        continuation = _CONTINUATION.match(line)
        if continuation:
            buffer.append(continuation.group(1))
            continue

        para_start = _PARA_START.match(line)
        if para_start:
            flush_paragraph()
            buffer.append(para_start.group(1))
            continue

        buffer.append(line)

    # Trailing text after the final page marker still belongs to the book.
    flush_paragraph()
    if pending:
        for block in pending:
            block.volume = volume
        book.blocks.extend(pending)

    return book
