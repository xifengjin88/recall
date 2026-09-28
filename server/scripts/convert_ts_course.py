"""One-off: turn the web app's exported TS course (JSON) into a course folder.

    cd web && EXPORT_COURSE_TO=/tmp/tlpi.json npx vitest run scripts/export-course.test.ts
    cd server && uv run python scripts/convert_ts_course.py /tmp/tlpi.json ../courses/tlpi

Every field goes through the same Pydantic models the importer uses, and the written folder is
parsed back and compared question by question with the source before the script reports success.
"""

import json
import re
import sys
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from recall_content import parse_course, write_course
from recall_content.hashing import content_hash
from recall_content.schemas import (
    CourseMeta,
    Exercise,
    OutlineEntry,
    ParsedCourse,
    ParsedUnit,
    Question,
    Section,
)

_QUESTION = TypeAdapter(Question)


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def _item(raw: dict[str, Any]) -> dict[str, Any]:
    """TS items use `id`; files use `key`."""
    out = {("key" if k == "id" else k): v for k, v in raw.items()}
    return out


def convert(src: dict[str, Any], slug: str) -> ParsedCourse:
    subject = src["subject"]
    units: list[ParsedUnit] = []
    for ch in src["chapters"]:
        units.append(
            ParsedUnit(
                number=ch["number"],
                title=ch["title"],
                note_title=ch.get("note"),
                folder=f"{ch['number']:02d}-{_slug(ch['title'])}",
                sections=tuple(Section(key=s["id"], title=s["title"]) for s in ch["sections"]),
                questions=tuple(_QUESTION.validate_python(_item(q)) for q in ch["questions"]),
                exercises=tuple(Exercise.model_validate(_item(x)) for x in ch["exercises"]),
                notes=ch["notes"],
            )
        )
    meta = CourseMeta(
        slug=slug,
        title=subject["title"],
        short=subject["short"],
        author=subject.get("author"),
        description=None,
        scheduling={},
    )
    outline = tuple(OutlineEntry(number=t["number"], title=t["title"]) for t in src["toc"])
    body = {"course": meta, "outline": outline, "units": tuple(units)}
    return ParsedCourse(
        **body, content_hash=content_hash(ParsedCourse.model_construct(**body, content_hash=""))
    )


def main(src_path: str, dest: str) -> int:
    src = json.loads(Path(src_path).read_text())
    course = convert(src, slug=Path(dest).name)
    write_course(course, Path(dest))
    back = parse_course(Path(dest))
    # Read-back check: every question, exercise and note equals the TS source.
    for unit, ch in zip(back.units, src["chapters"], strict=True):
        for q, raw in zip(unit.questions, ch["questions"], strict=True):
            got = q.model_dump(mode="json", by_alias=True, exclude_defaults=True)
            want = {k: v for k, v in _item(raw).items() if v is not None}
            want = _QUESTION.validate_python(want).model_dump(
                mode="json", by_alias=True, exclude_defaults=True
            )
            assert got == want, f"{q.key} differs after round trip"
        assert unit.notes == ch["notes"], f"notes for unit {unit.number} differ"
        assert len(unit.exercises) == len(ch["exercises"])
    total = sum(len(u.questions) for u in back.units)
    print(f"wrote {dest}: {len(back.units)} unit(s), {total} questions, {len(back.outline)} outline entries")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:3]))
