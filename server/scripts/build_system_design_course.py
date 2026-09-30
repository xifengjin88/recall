"""Turn system_design_notes/*.md (Obsidian) into courses/system-design notes.md + unit.yaml files.

Notes are kept as written, except:
- frontmatter is dropped (the course files carry the metadata);
- section headings get a section key ("## 6.2 ..."), replacing the note's own "1." numbering;
- sub-headings numbered like "### 2.1 ..." become "### <key>.1 ..." so they can't clash with section ids;
- the "## Flashcards" block is removed (its cards became questions.yaml).
Run from the repo root: server/.venv/bin/python server/scripts/build_system_design_course.py
It rewrites notes.md and unit.yaml only; questions.yaml files are hand-written and left alone.
If a note's headings change, section keys can shift: re-run `recall content validate` afterwards.
"""

import re
from pathlib import Path

import yaml

SRC = Path("system_design_notes")
OUT = Path("courses/system-design/units")

# (file stem, unit title), in the notes' own prev-link order; the long synthesis note is the capstone.
UNITS = [
    ("Anatomy of a Scalable Web Application", "Anatomy of a Scalable Web Application"),
    ("Approach for System Design Interviews + Uber-Lyft Design", "Interview Approach and Uber/Lyft Design"),
    ("Load Balancers and App Servers", "Load Balancers and App Servers"),
    ("Why Sharding is the Swiss Army Knife of System Design", "Why Sharding Is the Swiss Army Knife"),
    ("Distributed Caching Using Memcached", "Distributed Caching with Memcached"),
    ("CAP Theorem for Beginners", "CAP Theorem, ACID and BASE"),
    ("Sharding - Using Partition Functions", "Sharding with Partition Functions"),
    ("Dynamic Sharding", "Dynamic Sharding"),
    ("Sharding - Consistent Hashing", "Consistent Hashing"),
    ("Databases - Intro to Indexing and NoSQL", "Indexing and NoSQL"),
    ("Key-Value Stores incl. Object Stores, In Memory DBs", "Key-Value, Object and In-Memory Stores"),
    ("Wide Column Stores - HBase, Cassandra", "Wide-Column Stores"),
    ("Transaction Processing", "Transaction Processing"),
    ("Facebook Haystack (Optional Paper)", "Facebook Haystack"),
    ("Distributed File System Design (GFS)", "Distributed File Systems (GFS)"),
    ("Distributed Processing using MapReduce", "MapReduce"),
    ("Spatial Indexing - Nearest Neighbors Search", "Spatial Indexing"),
    ("Scalable web application anatomy", "Capstone: Scaling a Web App"),
]

# Headings kept as they are (not sections); "Flashcards" is removed with its body.
PLAIN = re.compile(r"^(video notes.*|my notes.*|sources|flashcards|conclusion)$", re.I)
NUMBERED = re.compile(r"^(\d+)\.\s+")
SUBNUMBERED = re.compile(r"^(\d+)\.(\d+)\s+")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
FENCE = re.compile(r"^\s*(>\s*)*(```|~~~)")
EMOJI = re.compile("[\U0001f300-\U0001faff☀-➿️]")


def clean_title(text: str) -> str:
    text = EMOJI.sub("", text)
    text = NUMBERED.sub("", text)
    text = re.sub(r"\s*\(with\s+notes\)", "", text)  # "ACID 🎓 (with 🌐 notes)" is about the note's sources
    return re.sub(r"\s+", " ", text).strip()


def strip_frontmatter(md: str) -> str:
    if md.startswith("---\n"):
        end = md.index("\n---\n", 4)
        return md[end + 5 :].lstrip("\n")
    return md


def scan(lines: list[str]) -> list[tuple[int, int, str]]:
    """(line index, level, text) for headings outside code fences."""
    out, fence = [], None
    for i, line in enumerate(lines):
        f = FENCE.match(line)
        if f:
            fence = f.group(2) if fence is None else (None if f.group(2) == fence else fence)
            continue
        if fence is None and (h := HEADING.match(line)):
            out.append((i, len(h.group(1)), h.group(2)))
    return out


def section_lines(heads: list[tuple[int, int, str]]) -> list[int]:
    """Which heading lines become sections: H2s, except plain ones and "Part" H2s whose numbered
    H3s are the real sections (then those H3s are)."""
    chosen: list[int] = []
    for n, (i, level, text) in enumerate(heads):
        if level != 2 or PLAIN.match(clean_title(text)):
            continue
        children = []
        for j, lvl, t in heads[n + 1 :]:
            if lvl <= 2:
                break
            if lvl == 3 and NUMBERED.match(t) and not SUBNUMBERED.match(t):
                children.append(j)
        if text.lower().startswith("part ") and children:
            chosen += children
        else:
            chosen.append(i)
    return chosen


def build(number: int, stem: str, title: str, renames: dict[str, dict[str, str]]) -> dict[str, object]:
    """Returns the unit (with its notes text); records renamed headings in renames[stem]."""
    md = strip_frontmatter((SRC / f"{stem}.md").read_text())
    lines = md.split("\n")
    heads = scan(lines)
    sections = set(section_lines(heads))

    # drop the Flashcards block: from its heading to the next H1/H2 (or the end)
    flash = [i for i, lvl, t in heads if lvl == 2 and clean_title(t).lower() == "flashcards"]
    drop: set[int] = set()
    for start in flash:
        end = next((i for i, lvl, _ in heads if i > start and lvl <= 2), len(lines))
        drop.update(range(start, end))

    unit_sections, current = [], None
    k = 0
    for i, level, text in heads:
        if i in drop:
            continue
        hashes = "#" * level
        if i in sections:
            k += 1
            current = f"{number}.{k}"
            body = NUMBERED.sub("", text)
            lines[i] = f"{hashes} {current} {body}"
            renames.setdefault(stem, {})[text] = f"{current} {body}"
            unit_sections.append({"key": current, "title": clean_title(text)})
        elif level == 2:
            current = None
        elif current and (m := SUBNUMBERED.match(text)):
            lines[i] = f"{hashes} {current}.{m.group(2)} {text[m.end() :]}"
            renames.setdefault(stem, {})[text] = lines[i][level + 1 :]

    kept = [line for i, line in enumerate(lines) if i not in drop]
    notes = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).rstrip() + "\n"
    # the note's H1 names the file for wikilinks; make it the stem so [[links]] and titles agree
    notes = re.sub(r"^# .*$", f"# {stem}", notes, count=1, flags=re.M)

    folder = f"{number:02d}-{re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')}"
    unit = {"number": number, "title": title, "note_title": stem, "sections": unit_sections}
    return {"folder": folder, "notes": notes, "stem": stem, **unit}


WIKILINK = re.compile(r"\[\[([^\]|#]*)#([^\]|]+)(\|[^\]]+)?\]\]")


def relink(notes: str, stem: str, renames: dict[str, dict[str, str]]) -> str:
    """Point [[Note#Heading]] / [[#Heading]] links at renamed headings, keeping the old text as the label."""

    def fix(m: re.Match[str]) -> str:
        page, heading, alias = m.group(1), m.group(2), m.group(3)
        new = renames.get(page or stem, {}).get(heading)
        if new is None:
            return m.group(0)
        label = alias or f"|{clean_title(heading)}"
        return f"[[{page}#{new}{label}]]"

    return WIKILINK.sub(fix, notes)


if __name__ == "__main__":
    renames: dict[str, dict[str, str]] = {}
    units = [build(n, stem, title, renames) for n, (stem, title) in enumerate(UNITS, start=1)]
    for u in units:
        folder = OUT / str(u.pop("folder"))
        folder.mkdir(parents=True, exist_ok=True)
        notes, stem = str(u.pop("notes")), str(u.pop("stem"))
        (folder / "notes.md").write_text(relink(notes, stem, renames))
        (folder / "unit.yaml").write_text(yaml.safe_dump(u, sort_keys=False, allow_unicode=True, width=1000))
        print(f"\n{folder.name}")
        for s in u["sections"]:  # type: ignore[union-attr]
            print(f"  {s['key']:6} {s['title']}")
