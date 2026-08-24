"""Tests for Arabic normalisation.

These guard a property the whole retrieval layer rests on: a query and the
corpus must fold to the same form, or lexical search silently returns nothing
for any Arabic term.
"""

import pytest

from normalize_ar import has_arabic, normalize_arabic, normalize_query


@pytest.mark.parametrize(
    "raw,expected",
    [
        # Diacritics and alef wasla (Uthmani script as it appears in Tanzil).
        ("بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ", "بسم الله الرحمن الرحيم"),
        ("وَإِذَا ضَرَبْتُمْ فِى ٱلْأَرْضِ", "واذا ضربتم في الارض"),
        # All four alef forms collapse to bare alef.
        ("آ أ إ ٱ ا", "ا ا ا ا ا"),
        # Ta marbuta -> ha, alef maksura -> ya.
        ("الصَّلَاةُ عَلَى مُوسَى", "الصلاه علي موسي"),
        # Hamza-carrier folding.
        ("مُؤْمِن سَئِمَ", "مومن سيم"),
        # Tatweel is purely typographic.
        ("الحـــمد", "الحمد"),
        # Arabic-Indic and Extended Arabic-Indic digits normalise to ASCII.
        ("رقم ١٢٣٤", "رقم 1234"),
        ("رقم ۱۲۳۴", "رقم 1234"),
        # Qur'anic annotation marks carry no lexical weight.
        ("الْحَمْدُ لِلَّهِ ۝", "الحمد لله"),
        ("﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾", "قل هو الله احد"),
        # Whitespace collapses.
        ("  الحمد    لله  ", "الحمد لله"),
        # Degenerate input.
        ("", ""),
        (None, ""),
    ],
)
def test_normalize_arabic(raw, expected):
    assert normalize_arabic(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
        "الصَّلَاةُ عَلَى مُوسَى",
        "﴿قُلْ هُوَ ٱللَّهُ أَحَدٌ﴾",
    ],
)
def test_normalisation_is_idempotent(raw):
    once = normalize_arabic(raw)
    assert normalize_arabic(once) == once


def test_vocalised_and_bare_forms_converge():
    """The point of the whole module: the same word written two ways must match."""
    assert normalize_arabic("ٱلصَّلَاة") == normalize_arabic("الصلاة")
    assert normalize_arabic("مُوسَىٰ") == normalize_arabic("موسى")


def test_query_folds_the_same_way_as_the_corpus():
    """A query must land on the same string the indexer stored."""
    corpus = normalize_arabic("وَإِذَا ضَرَبْتُمْ فِى ٱلْأَرْضِ")
    assert normalize_query("ضَرَبْتُمْ") in corpus


def test_has_arabic():
    assert has_arabic("الصلاة")
    assert has_arabic("what does الصلاة mean")
    assert not has_arabic("is it permissible to combine prayers")
    assert not has_arabic("")
    assert not has_arabic(None)


def test_english_query_is_left_for_postgres_to_stem():
    """Latin text passes through untouched apart from whitespace.

    Case folding and stemming are Postgres' job via the English text-search
    configuration; doing it here as well would only desynchronise the two.
    """
    assert normalize_query("  Combining   Prayers  ") == "Combining Prayers"
