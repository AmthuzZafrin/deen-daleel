"""Fetching texts from the OpenITI corpus.

OpenITI (https://openiti.org) is an academic corpus of ~7,700 premodern Arabic
works, released under **CC BY-NC-SA 4.0**. That licence is the reason
`sources.license` is NOT NULL: the terms travel with the text, oblige visible
attribution, and forbid commercial use. Deen & Daleel is non-commercial by
decision, which is what makes this corpus usable at all.

Texts live in GitHub repositories bucketed by the author's death year in AH,
rounded up to the next 25 years — al-Tabari died in 310 AH, so his works are in
`0325AH`. Within a repo the path is derived from the version URI:

    0310Tabari.JamicBayan.Shamela0007798-ara1
    └─ author ──┘ └─ book ─┘ └─── version ───┘

    OpenITI/0325AH/data/0310Tabari/0310Tabari.JamicBayan/<version><ext>

The file extension records editorial state (`.mARkdownSimple`, `.completed`,
`.inProgress`, or none) and is not in the metadata, so the candidates are tried
in order of preference.

Downloads are cached under `ingest/.cache/openiti/`. These files are tens of
megabytes and the corpus is re-chunked often; re-downloading on every run would
be slow and rude to a volunteer-run academic project.
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import httpx

from config import INGEST_DIR

CACHE_DIR = INGEST_DIR / ".cache" / "openiti"
RAW_BASE = "https://raw.githubusercontent.com/OpenITI"

LICENSE = "CC BY-NC-SA 4.0"
ATTRIBUTION = "OpenITI corpus (openiti.org), CC BY-NC-SA 4.0"

# Preferred first: the simplified mARkdown carries the structural markup we
# parse. A bare version URI with no suffix is the plain text and works too.
_EXTENSIONS = (".mARkdownSimple", ".mARkdown", ".completed", ".inProgress", "")

_VERSION_URI = re.compile(r"^(\d{4})([A-Za-z][\w]*)\.([\w]+)\.(.+)$")


class OpenITIError(RuntimeError):
    pass


def parse_version_uri(uri: str) -> tuple[int, str, str]:
    """Split a version URI into (death year AH, author id, book id)."""
    match = _VERSION_URI.match(uri.strip())
    if not match:
        raise OpenITIError(
            f"not an OpenITI version URI: {uri!r}\n"
            f"expected e.g. 0310Tabari.JamicBayan.Shamela0007798-ara1"
        )
    year, author, book, _version = match.groups()
    return int(year), f"{year}{author}", f"{year}{author}.{book}"


def repo_for_year(year: int) -> str:
    """The century repo holding an author who died in `year` AH."""
    bucket = ((year + 24) // 25) * 25
    return f"{bucket:04d}AH"


def candidate_urls(uri: str) -> list[str]:
    """Every plausible raw URL for this text, best first."""
    year, author_id, book_id = parse_version_uri(uri)
    urls = []
    # The bucket boundary is occasionally off by one repo in the metadata, so
    # the neighbours are tried before giving up.
    for bucket_year in (year, year + 25, year - 25):
        if bucket_year <= 0:
            continue
        repo = repo_for_year(bucket_year)
        for ext in _EXTENSIONS:
            urls.append(f"{RAW_BASE}/{repo}/master/data/{author_id}/{book_id}/{uri}{ext}")
    return urls


def fetch(uri: str, *, refresh: bool = False, timeout: float = 180.0) -> str:
    """Return the raw text of an OpenITI version, downloading it once.

    Raises OpenITIError if no candidate URL resolves, listing what was tried —
    a version URI can be valid in the metadata but absent from GitHub.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = CACHE_DIR / f"{uri}.txt"

    if cached.exists() and not refresh:
        return cached.read_text(encoding="utf-8")

    tried: list[str] = []
    with httpx.Client(follow_redirects=True, timeout=timeout) as client:
        for url in candidate_urls(uri):
            tried.append(url)
            delay = 2.0
            for attempt in range(3):
                try:
                    resp = client.get(url)
                except httpx.RequestError:
                    if attempt == 2:
                        break
                    time.sleep(delay)
                    delay *= 2
                    continue

                if resp.status_code == 200:
                    text = resp.text
                    # A 200 serving an HTML error page would poison the cache.
                    if "#META#" not in text[:4000]:
                        break
                    cached.write_text(text, encoding="utf-8")
                    return text

                if resp.status_code == 404:
                    break  # wrong candidate, try the next
                if resp.status_code >= 500 and attempt < 2:
                    time.sleep(delay)
                    delay *= 2
                    continue
                break

    listed = "\n  ".join(tried[:6])
    raise OpenITIError(
        f"could not fetch {uri} — tried {len(tried)} URLs, first few:\n  {listed}"
    )


def cache_path(uri: str) -> Path:
    return CACHE_DIR / f"{uri}.txt"
