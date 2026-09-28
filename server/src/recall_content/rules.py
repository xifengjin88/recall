"""Cross-field and cross-file content rules. Each returns errors (never raises) so all are reported."""

from collections.abc import Iterable, Sequence
from typing import Any

from recall_engine import CardKind, resolve_preset

from .errors import ContentError
from .loader import Located, YamlDoc
from .notes import extract_section
from .schemas import CourseFile, Exercise, Match, Multi, Order, Output, Single, Typed, UnitFile


def _dupes(values: Sequence[str]) -> bool:
    return len(set(values)) != len(values)


def check_question(loc: Located[Any], unit: UnitFile) -> list[ContentError]:
    q = loc.item
    key: str = q.key
    errors: list[ContentError] = []

    def err(message: str, field: str | None = None) -> None:
        errors.append(loc.error(message, field, key))

    if q.section not in {s.key for s in unit.sections}:
        err(f'section "{q.section}" is not in unit {unit.number}', "section")

    if isinstance(q, Single) or (isinstance(q, Output) and q.options is not None):
        options: tuple[str, ...] = q.options or ()
        if _dupes(options):
            err("options contain duplicates", "options")
        if q.answer not in options:
            err(f'answer "{q.answer}" is not among the options', "answer")
    if isinstance(q, Multi):
        if _dupes(q.options):
            err("options contain duplicates", "options")
        if not q.answers:
            err("multi question has no answers", "answers")
        for a in q.answers:
            if a not in q.options:
                err(f'answer "{a}" is not among the options', "answers")
    if isinstance(q, Typed) or (isinstance(q, Output) and q.accept is not None):
        accept: tuple[str, ...] = q.accept or ()
        if not any(a.strip() for a in accept):
            err('"accept" list is empty', "accept")
    if isinstance(q, Order) and _dupes(q.items):
        err("items contain duplicates", "items")
    if isinstance(q, Match):
        if not 3 <= len(q.pairs) <= 6:
            err("match needs 3–6 pairs", "pairs")
        elif _dupes([p.definition for p in q.pairs]):
            err("match definitions must be distinct", "pairs")
        elif _dupes([p.term for p in q.pairs]):
            err("match terms must be distinct", "pairs")
    return errors


def check_exercise(loc: Located[Exercise], unit: UnitFile) -> list[ContentError]:
    ex = loc.item
    errors: list[ContentError] = []
    known = {s.key for s in unit.sections}
    for s in ex.sections:
        if s not in known:
            errors.append(loc.error(f'section "{s}" is not in unit {unit.number}', "sections", ex.key))
    if _dupes([t.name for t in ex.tests]):
        errors.append(loc.error("test names must be unique", "tests", ex.key))
    return errors


def check_unique_keys(items: Iterable[Located[Any]]) -> list[ContentError]:
    """Question and exercise keys are unique across the whole course."""
    seen: dict[str, Located[Any]] = {}
    errors: list[ContentError] = []
    for loc in items:
        key: str = loc.item.key
        first = seen.get(key)
        if first is None:
            seen[key] = loc
            continue
        where = f"{first.file}:{first.doc.line(first.path)}"
        errors.append(loc.error(f"duplicate key {key} (also in {where})", None, key))
    return errors


def check_sections(unit: UnitFile, rel: str, doc: YamlDoc) -> list[ContentError]:
    seen: set[str] = set()
    errors: list[ContentError] = []
    for i, s in enumerate(unit.sections):
        if s.key in seen:
            errors.append(
                ContentError(rel, doc.line(("sections", i)), None, f'section key "{s.key}" appears twice')
            )
        seen.add(s.key)
    return errors


def check_course(course: CourseFile, doc: YamlDoc) -> list[ContentError]:
    errors: list[ContentError] = []
    seen: set[int] = set()
    for i, entry in enumerate(course.outline):
        if entry.number in seen:
            errors.append(
                ContentError(
                    "course.yaml",
                    doc.line(("outline", i)),
                    None,
                    f"outline number {entry.number} appears twice",
                )
            )
        seen.add(entry.number)
    for kind, options in course.scheduling.items():
        try:
            resolve_preset(CardKind(kind), options)
        except ValueError as err:
            first = next(iter(options), None)
            unknown = sorted(set(options) - set(resolve_preset(CardKind(kind)).__dataclass_fields__))
            line = doc.line(("scheduling", kind, unknown[0] if unknown else first or ""))
            errors.append(ContentError("course.yaml", line, None, f"scheduling.{kind}: {err}"))
    return errors


def check_notes(notes: str, unit: UnitFile, rel: str, items: Iterable[Located[Any]]) -> list[ContentError]:
    """Every section needs a heading in notes.md; every note_anchor must name one."""
    errors: list[ContentError] = [
        ContentError(f"{rel}/notes.md", None, None, f"no heading for section {s.key}")
        for s in unit.sections
        if extract_section(notes, section=s.key) is None
    ]
    for loc in items:
        anchor: str | None = loc.item.note_anchor
        if anchor and extract_section(notes, anchor=anchor) is None:
            errors.append(
                loc.error(f'note_anchor "{anchor}" is not a heading in notes.md', "note_anchor", loc.item.key)
            )
    return errors
