"""Study-note headings, ported from web/app/lib/notes.ts so ids match the web app exactly.

A heading that starts with a section key ("## 2.7 Processes") gets the id "s2.7"; others are slugged.
"""

import re
from dataclasses import dataclass

_SECTION = re.compile(r"^(\d+\.\d+)\s", re.ASCII)
_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_FENCE = re.compile(r"^\s*(>\s*)*(```|~~~)")


def heading_id(text: str) -> str:
    stripped = text.strip()
    m = _SECTION.match(stripped)
    if m:
        return f"s{m.group(1)}"
    slug = re.sub(r"[`*_]", "", stripped.lower())
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return re.sub(r"^-|-$", "", slug)


@dataclass(frozen=True, slots=True)
class _Row:
    line: str
    level: int | None  # heading level, None for non-heading lines (incl. inside code fences)
    text: str | None


def _scan(md: str) -> list[_Row]:
    rows: list[_Row] = []
    fence: str | None = None
    for line in md.split("\n"):
        f = _FENCE.match(line)
        if f:
            if fence is None:
                fence = f.group(2)
            elif f.group(2) == fence:
                fence = None
            rows.append(_Row(line, None, None))
            continue
        h = _HEADING.match(line) if fence is None else None
        rows.append(_Row(line, len(h.group(1)), h.group(2)) if h else _Row(line, None, None))
    return rows


def extract_section(md: str, section: str | None = None, anchor: str | None = None) -> str | None:
    """Markdown from the matching heading to the next heading of the same or higher level."""
    want = heading_id(anchor) if anchor else f"s{section}" if section else None
    if not want:
        return None
    rows = _scan(md)
    start = next(
        (
            i
            for i, r in enumerate(rows)
            if r.level is not None and r.level > 1 and heading_id(r.text or "") == want
        ),
        None,
    )
    if start is None:
        return None
    level = rows[start].level or 0
    end = len(rows)
    for i in range(start + 1, len(rows)):
        row_level = rows[i].level
        if row_level is not None and row_level <= level:
            end = i
            break
    text = "\n".join(r.line for r in rows[start:end])
    return re.sub(r"\n-{3,}\s*\Z", "", text).strip()


@dataclass(frozen=True, slots=True)
class TocItem:
    id: str
    text: str


def note_toc(md: str) -> list[TocItem]:
    return [TocItem(heading_id(r.text or ""), r.text or "") for r in _scan(md) if r.level == 2]
