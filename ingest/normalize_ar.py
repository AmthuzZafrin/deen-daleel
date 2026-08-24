"""Arabic text normalisation for retrieval.

The output of this module is *never displayed to a user*. It exists purely so
that lexical search matches across the orthographic variation that is normal in
Arabic text: the same word may appear with or without diacritics, with any of
four alef forms, and with Arabic-Indic or Western digits.

Displayed text always comes from `documents.arabic_text`, which is stored exactly
as the source gave it — fully vocalised Qur'anic text included. Stripping
diacritics from displayed Qur'an would be a serious error; stripping them from
the search index is required for anything to match at all.
"""

from __future__ import annotations

import re
import unicodedata

# --- Marks that carry no lexical weight for search -------------------------

# U+064B..U+065F  tanween, fatha/damma/kasra, shadda, sukun and extended marks
# U+0670          superscript (dagger) alef
# U+06D6..U+06ED  Qur'anic annotation: waqf marks, sajdah, small high letters
# U+0640          tatweel / kashida (pure typographic elongation)
_DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭـ]")

# U+06DD end-of-ayah sign, U+FD3E/U+FD3F ornate parentheses used around ayah
# numbers, and the Arabic thousands/number separators that appear mid-verse.
_QURANIC_MARKUP = re.compile(r"[۝۞۩﴾﴿]")

# Zero-width characters that survive copy-paste from many PDF and web sources
# and would otherwise split a word in the middle for trigram matching.
_ZERO_WIDTH = re.compile(r"[​-‏‪-‮⁠﻿]")

# --- Letter folding --------------------------------------------------------

# Collapse orthographic variants that readers treat as the same letter. Ta
# marbuta folds to ha, which is the usual convention in Arabic IR (the
# alternative, folding to ta, loses more recall on nouns in pausal form).
_FOLD = str.maketrans(
    {
        "آ": "ا",  # آ  alef with madda      -> ا
        "أ": "ا",  # أ  alef with hamza above -> ا
        "إ": "ا",  # إ  alef with hamza below -> ا
        "ٱ": "ا",  # ٱ  alef wasla            -> ا
        "ى": "ي",  # ى  alef maksura          -> ي
        "ة": "ه",  # ة  ta marbuta            -> ه
        "ؤ": "و",  # ؤ  waw with hamza        -> و
        "ئ": "ي",  # ئ  yeh with hamza        -> ي
    }
)

# Arabic-Indic (U+0660..) and Extended Arabic-Indic (U+06F0..) digits.
_DIGITS = str.maketrans(
    {chr(0x0660 + i): str(i) for i in range(10)}
    | {chr(0x06F0 + i): str(i) for i in range(10)}
)

_WHITESPACE = re.compile(r"\s+")

# Arabic script block, used to decide whether a string is worth indexing as
# Arabic at all.
_ARABIC_CHAR = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")


def normalize_arabic(text: str | None) -> str:
    """Fold Arabic text into a search-friendly form.

    Idempotent: normalising an already-normalised string returns it unchanged.

    >>> normalize_arabic("وَإِذَا ضَرَبْتُمْ فِي الْأَرْضِ")
    'واذا ضربتم في الارض'
    """
    if not text:
        return ""

    # NFC first: some sources encode a letter+diacritic as a single precomposed
    # codepoint, which the ranges above would otherwise miss entirely.
    out = unicodedata.normalize("NFC", text)

    out = _ZERO_WIDTH.sub("", out)
    out = _QURANIC_MARKUP.sub(" ", out)
    out = _DIACRITICS.sub("", out)
    out = out.translate(_FOLD)
    out = out.translate(_DIGITS)
    out = _WHITESPACE.sub(" ", out)
    return out.strip()


def has_arabic(text: str | None) -> bool:
    """True if the string contains any Arabic-script character."""
    return bool(text) and bool(_ARABIC_CHAR.search(text))


def normalize_query(text: str) -> str:
    """Normalise a user's search string.

    Applies the same folding to any Arabic in the query that was applied to the
    corpus. Latin text passes through with whitespace collapsed only — the
    English half of the query is handled by Postgres' English text-search
    configuration, which does its own stemming and case folding.
    """
    if not text:
        return ""
    out = unicodedata.normalize("NFC", text)
    out = _ZERO_WIDTH.sub("", out)
    if has_arabic(out):
        out = normalize_arabic(out)
    return _WHITESPACE.sub(" ", out).strip()
