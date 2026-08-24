"""Tests for the OpenITI mARkdown parser.

The cases that matter are the ones that fail silently in production: a page
number attached to the wrong paragraph produces a citation that looks fine and
points at the wrong place, which is worse for this app than no citation at all.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from parsers.markdown import parse_markdown  # noqa: E402

SAMPLE = """######OpenITI#

#META# 010.AuthorNAME\t:: محمد بن جرير الطبري
#META# 020.BookTITLE\t:: جامع البيان
#META# 020.BookTITLESUB\t:: NODATA
#META# 031.LibREADONLINE\t:: http://shamela.ws/browse.php/book_7798
#META#Header#End#

### | كتاب الصلاة

بسم الله الرحمن
الرحيم وبه ثقتي

فصل في المواقيت
PageV01P003

### || باب السفر

قال أبو جعفر
PageV01P004

### ||| مسألة

نص المسألة
PageV02P010
"""


def test_meta_is_read():
    book = parse_markdown(SAMPLE)
    assert book.title == "جامع البيان"
    assert book.author == "محمد بن جرير الطبري"
    assert book.permalink == "http://shamela.ws/browse.php/book_7798"


def test_nodata_is_dropped():
    """OpenITI writes NODATA rather than omitting a field; it is not a value."""
    book = parse_markdown(SAMPLE)
    assert "020.BookTITLESUB" not in book.meta


def test_hard_wrapped_lines_are_rejoined():
    book = parse_markdown(SAMPLE)
    assert book.blocks[0].text == "بسم الله الرحمن الرحيم وبه ثقتي"


def test_blank_line_separates_paragraphs():
    book = parse_markdown(SAMPLE)
    assert book.blocks[0].text.startswith("بسم الله")
    assert book.blocks[1].text == "فصل في المواقيت"


def test_page_marker_terminates_the_page_above_it():
    """Text above PageV01P003 is page 3 — not the text below it."""
    book = parse_markdown(SAMPLE)
    assert (book.blocks[0].volume, book.blocks[0].page) == (1, 3)
    assert (book.blocks[1].volume, book.blocks[1].page) == (1, 3)
    assert (book.blocks[2].volume, book.blocks[2].page) == (1, 4)


def test_volume_changes_are_tracked():
    book = parse_markdown(SAMPLE)
    assert (book.blocks[-1].volume, book.blocks[-1].page) == (2, 10)


def test_headings_nest_into_a_breadcrumb():
    book = parse_markdown(SAMPLE)
    assert book.blocks[0].heading == "كتاب الصلاة"
    assert book.blocks[2].heading == "كتاب الصلاة › باب السفر"
    assert book.blocks[3].heading == "كتاب الصلاة › باب السفر › مسألة"


def test_shallower_heading_pops_deeper_ones():
    """A new level-2 must drop the level-3 beneath the previous one.

    Without this a Shafi'i section inherits the breadcrumb of the Hanafi
    subsection above it, and the retrieved evidence silently misattributes a
    school's position.
    """
    text = SAMPLE + """
### || باب آخر

نص جديد
PageV02P011
"""
    book = parse_markdown(text)
    assert book.blocks[-1].heading == "كتاب الصلاة › باب آخر"


def test_trailing_text_after_last_marker_is_kept():
    text = SAMPLE + "\nذيل بلا علامة صفحة\n"
    book = parse_markdown(text)
    assert book.blocks[-1].text == "ذيل بلا علامة صفحة"
    assert book.blocks[-1].volume == 2  # carries the last volume seen


def test_noise_markers_are_dropped():
    text = SAMPLE.replace("فصل في المواقيت", "فصل%~% في المواقيت")
    book = parse_markdown(text)
    assert all("%~%" not in b.text for b in book.blocks)


def test_missing_header_sentinel_still_finds_the_body():
    text = SAMPLE.replace("#META#Header#End#\n", "")
    book = parse_markdown(text)
    assert book.title == "جامع البيان"
    assert any("بسم الله" in b.text for b in book.blocks)


def test_inline_page_marker_is_stripped_and_splits_the_paragraph():
    """`PageEndV01P408` appears mid-sentence and must not survive into the text.

    Tabari carries 14,490 of these. Left in, they land in the middle of quoted
    scripture in whatever the reader sees.
    """
    text = """#META#Header#End#

### | باب

أول الكلام PageEndV01P408 آخر الكلام
PageV01P409
"""
    book = parse_markdown(text)
    assert all("PageEnd" not in b.text for b in book.blocks)
    assert [(b.text, b.volume, b.page) for b in book.blocks] == [
        ("أول الكلام", 1, 408),
        ("آخر الكلام", 1, 409),
    ]


def test_inline_and_standalone_markers_keep_document_order():
    """Text must come back in the order it was written, however it was numbered."""
    text = """#META#Header#End#

### | باب

فقرة أولى
PageV01P001

فقرة ثانية PageEndV01P002 فقرة ثالثة
PageV01P003
"""
    book = parse_markdown(text)
    assert [b.text for b in book.blocks] == [
        "فقرة أولى",
        "فقرة ثانية",
        "فقرة ثالثة",
    ]
    assert [b.page for b in book.blocks] == [1, 2, 3]


def test_hash_starts_a_paragraph_and_tilde_continues_it():
    """The full mARkdown convention, as distinct from the Simple variant.

    `# ` opens a paragraph and `~~` continues the line above. Handled wrongly,
    the markers reach the reader and the whole book becomes one paragraph.
    """
    text = """#META#Header#End#

### |EDITOR|
# الفقرة الأولى تبدأ هنا
~~وتستمر في السطر التالي
# الفقرة الثانية
PageV01P005
"""
    book = parse_markdown(text)
    assert [b.text for b in book.blocks] == [
        "الفقرة الأولى تبدأ هنا وتستمر في السطر التالي",
        "الفقرة الثانية",
    ]
    assert all("~~" not in b.text and not b.text.startswith("#") for b in book.blocks)


def test_named_heading_form_loses_its_trailing_pipe():
    text = "#META#Header#End#\n\n### |EDITOR|\n# نص\nPageV01P001\n"
    book = parse_markdown(text)
    assert book.blocks[0].heading == "EDITOR"


def test_empty_input_is_not_an_error():
    book = parse_markdown("")
    assert book.blocks == []
    assert book.meta == {}


# ---------------------------------------------------------------------------
# Editorial marks inside a line
#
# These all began as one bug: the noise test was `search` on the whole line and
# skipped it. `%~%` separates the hemistichs of a verse, so every line of poetry
# in the corpus was thrown away — 2,145 lines of Tabari alone. The other two
# were never stripped at all and reached both the reader and the embedding.
# ---------------------------------------------------------------------------


def test_verse_separator_is_removed_without_losing_the_line():
    text = "#META#Header#End#\n\n# وما أنت غير الكون %~% ويفهم هذا السر\nPageV01P003\n"
    book = parse_markdown(text)
    assert len(book.blocks) == 1, "the line must survive its separator"
    assert "%~%" not in book.blocks[0].text
    assert "وما أنت غير الكون" in book.blocks[0].text
    assert "ويفهم هذا السر" in book.blocks[0].text


def test_milestone_markers_are_stripped_from_the_text():
    text = "#META#Header#End#\n\n# ولا يجب وانما ms01 جعل الخبر حجة ms0262 بشرائط\nPageV01P003\n"
    book = parse_markdown(text)
    assert "ms01" not in book.blocks[0].text
    assert "ms0262" not in book.blocks[0].text
    assert "جعل الخبر حجة" in book.blocks[0].text


def test_quran_quote_tags_are_stripped_but_the_quotation_stays():
    text = "#META#Header#End#\n\n# وقال @QB@ إن إلى ربك الرجعى @QE@ الآية\nPageV01P003\n"
    book = parse_markdown(text)
    assert "@QB@" not in book.blocks[0].text
    assert "@QE@" not in book.blocks[0].text
    assert "إن إلى ربك الرجعى" in book.blocks[0].text


def test_a_line_of_pure_noise_is_dropped_rather_than_left_blank():
    text = "#META#Header#End#\n\n# نص أول\nms0100\n# نص ثان\nPageV01P003\n"
    book = parse_markdown(text)
    assert [b.text for b in book.blocks] == ["نص أول", "نص ثان"]


def test_rule_lines_are_still_dropped_whole():
    text = "#META#Header#End#\n\n# نص\n#####\nPageV01P003\n"
    book = parse_markdown(text)
    assert [b.text for b in book.blocks] == ["نص"]


def test_a_word_ending_in_ms_is_not_mistaken_for_a_milestone():
    text = "#META#Header#End#\n\n# the psalms 12 and hakams 3 remain\nPageV01P003\n"
    book = parse_markdown(text)
    assert "psalms 12" in book.blocks[0].text
    assert "hakams 3" in book.blocks[0].text


# ---------------------------------------------------------------------------
# Markup from the source digitisations
#
# Found by auditing every work for surviving ASCII inside Arabic text. A quarter
# of Sunan Abi Dawud was HTML; 6,329 blocks of Sahih Muslim kept a `### $`
# prefix. Together with the milestone markers above this was ~40,000 artifacts,
# now 281 across 451,609 blocks.
# ---------------------------------------------------------------------------


def test_html_wrapper_blocks_are_removed_entirely():
    text = (
        "#META#Header#End#\n\n"
        '<div dir="rtl" id="book-container">\n'
        "# نص الحديث\n"
        "</div>\n"
        "PageV01P003\n"
    )
    book = parse_markdown(text)
    assert [b.text for b in book.blocks] == ["نص الحديث"]


def test_html_inside_a_line_is_stripped_but_the_text_stays():
    text = '#META#Header#End#\n\n# قال <span class="x">النبي</span> صلى الله عليه\nPageV01P003\n'
    book = parse_markdown(text)
    assert "<" not in book.blocks[0].text and "span" not in book.blocks[0].text
    assert "قال" in book.blocks[0].text and "النبي" in book.blocks[0].text


def test_entry_marker_opens_a_paragraph_without_becoming_a_heading():
    text = (
        "#META#Header#End#\n\n"
        "### || كتاب الإيمان\n"
        "### $ وحدثنا أبو بكر بن أبي شيبة\n"
        "### $ وحدثني زهير بن حرب\n"
        "PageV01P003\n"
    )
    book = parse_markdown(text)
    assert len(book.blocks) == 2, "each entry is its own block"
    assert all(not b.text.startswith("#") and "$" not in b.text for b in book.blocks)
    # The chapter must survive: the entries sit beneath it, they do not replace it.
    assert all(b.heading == "كتاب الإيمان" for b in book.blocks)


def test_inline_footnote_rule_is_stripped_without_dropping_the_line():
    text = "#META#Header#End#\n\n# (13) وإذا قيل لهم آمنوا ____________________\nPageV01P003\n"
    book = parse_markdown(text)
    assert "_" not in book.blocks[0].text
    assert "وإذا قيل لهم آمنوا" in book.blocks[0].text


def test_a_malformed_page_marker_is_stripped_but_real_ones_still_parse():
    text = (
        "#META#Header#End#\n\n"
        "# صحيح مسلم بشرح النووي PageV0MP001\n"
        "PageV02P007\n"
    )
    book = parse_markdown(text)
    assert "PageV0MP001" not in book.blocks[0].text
    assert "Page" not in book.blocks[0].text
    # The well-formed marker must still have been read.
    assert (book.blocks[0].volume, book.blocks[0].page) == (2, 7)


def test_a_leading_pipe_heading_does_not_reach_the_reader():
    text = "#META#Header#End#\n\n|| ( 1 ذكر أفضل الأعمال )\nPageV01P003\n"
    book = parse_markdown(text)
    assert all("||" not in b.text for b in book.blocks)
