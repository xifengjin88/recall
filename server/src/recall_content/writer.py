"""write_course: ParsedCourse → a course folder (the inverse of parse_course)."""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

from .schemas import ParsedCourse

# Field order in written files: identity first, then the question, then answers, then help text.
_ORDER = (
    "key", "type", "title", "section", "sections", "book_ref", "difficulty", "estimate", "tags",
    "prompt", "code", "goal", "background", "requirements", "constraints", "example",
    "options", "answer", "answers", "accept", "case_sensitive", "items", "pairs", "keep_order", "tests",
    "hint", "hints", "stretch", "explanation", "note_anchor", "retired",
)  # fmt: skip


def _plain(model: BaseModel) -> dict[str, Any]:
    """snake_case dict without defaults, in the order an author reads it."""
    data = model.model_dump(mode="json", exclude_defaults=True)
    ordered = {k: data.pop(k) for k in _ORDER if k in data}
    return {**ordered, **data}


def _dump(data: Any, spaced: bool = False) -> str:
    text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=110, default_flow_style=False)
    # A blank line between items keeps long question and exercise files scannable.
    return text.replace("\n- key:", "\n\n- key:") if spaced else text


def write_course(parsed: ParsedCourse, root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    course = parsed.course.model_dump(mode="json", exclude_none=True)
    if not course.get("scheduling"):
        course.pop("scheduling", None)
    course["outline"] = [o.model_dump(mode="json") for o in parsed.outline]
    (root / "course.yaml").write_text(_dump(course))
    for unit in parsed.units:
        folder = root / "units" / unit.folder
        folder.mkdir(parents=True, exist_ok=True)
        unit_yaml: dict[str, Any] = {"number": unit.number, "title": unit.title}
        if unit.note_title:
            unit_yaml["note_title"] = unit.note_title
        unit_yaml["sections"] = [s.model_dump(mode="json") for s in unit.sections]
        (folder / "unit.yaml").write_text(_dump(unit_yaml))
        if unit.questions:
            (folder / "questions.yaml").write_text(_dump([_plain(q) for q in unit.questions], spaced=True))
        if unit.exercises:
            (folder / "exercises.yaml").write_text(_dump([_plain(x) for x in unit.exercises], spaced=True))
        if unit.notes is not None:
            (folder / "notes.md").write_text(unit.notes)
