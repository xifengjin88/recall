"""write_course: ParsedCourse → a course folder (the inverse of parse_course)."""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

from .schemas import ParsedCourse


def _plain(model: BaseModel) -> dict[str, Any]:
    """snake_case dict without defaults, with key and type first for readability."""
    data = model.model_dump(mode="json", exclude_defaults=True)
    first = {k: data.pop(k) for k in ("key", "type") if k in data}
    return {**first, **data}


def _dump(data: Any) -> str:
    return yaml.safe_dump(data, sort_keys=False, allow_unicode=True, width=110, default_flow_style=False)


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
            (folder / "questions.yaml").write_text(_dump([_plain(q) for q in unit.questions]))
        if unit.exercises:
            (folder / "exercises.yaml").write_text(_dump([_plain(x) for x in unit.exercises]))
        if unit.notes is not None:
            (folder / "notes.md").write_text(unit.notes)
