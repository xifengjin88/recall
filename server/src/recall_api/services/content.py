"""Importing course folders into Postgres, and exporting them back (SPEC-content-import.md)."""

from dataclasses import dataclass, field
from typing import Any

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_content import assemble, content_hash
from recall_content.schemas import (
    CourseMeta,
    Exercise,
    OutlineEntry,
    ParsedCourse,
    ParsedUnit,
    Question,
    Section,
)

from ..models import Course, ImportRun, Item, Notes, Unit
from ..models import Section as SectionRow

_QUESTION = TypeAdapter(Question)


@dataclass
class ImportSummary:
    slug: str
    added: list[str] = field(default_factory=list[str])
    changed: list[str] = field(default_factory=list[str])
    retired: list[str] = field(default_factory=list[str])
    unchanged: int = 0
    units_changed: int = 0
    notes_changed: int = 0
    kinds: dict[str, str] = field(default_factory=dict[str, str])  # key -> "question" | "exercise"

    def describe(self) -> str:
        def count(keys: list[str], kind: str) -> int:
            return sum(1 for k in keys if self.kinds.get(k) == kind)

        def plural(n: int, word: str) -> str:
            return f"{n} {word}{'' if n == 1 else 's'}"

        added = f"{plural(count(self.added, 'question'), 'question')}, {plural(count(self.added, 'exercise'), 'exercise')}"
        return (
            f"imported {self.slug}: added {added} · changed {len(self.changed)} · retired {len(self.retired)}"
            f" · unchanged {self.unchanged} · units changed {self.units_changed} · notes changed {self.notes_changed}"
        )

    def as_json(self) -> dict[str, Any]:
        return {
            "added": self.added,
            "changed": self.changed,
            "retired": self.retired,
            "unchanged": self.unchanged,
            "unitsChanged": self.units_changed,
            "notesChanged": self.notes_changed,
        }


def _set(obj: Any, **values: Any) -> bool:
    """Assign only attributes whose value differs, so unchanged rows produce no UPDATE."""
    changed = False
    for name, value in values.items():
        if getattr(obj, name) != value:
            setattr(obj, name, value)
            changed = True
    return changed


def item_body(item: Any) -> dict[str, Any]:
    """What the API serves for an item: camelCase, `id` = key, defaults left out (like the TS content)."""
    dumped = item.model_dump(mode="json", by_alias=True, exclude_defaults=True)
    return {"id": dumped.pop("key"), **dumped}


def _item_fields(item: Any, kind: str, unit_id: Any, position: int) -> dict[str, Any]:
    question = kind == "question"
    return {
        "unit_id": unit_id,
        "kind": kind,
        "type": item.type if question else None,
        "section_keys": [item.section] if question else list(item.sections),
        "difficulty": item.difficulty,
        "tags": list(item.tags) if question else [],
        "body": item_body(item),
        "retired": item.retired,
        "position": position,
        "content_hash": content_hash(item),
    }


def import_course(session: Session, parsed: ParsedCourse, dry_run: bool = False) -> ImportSummary:
    """Upsert a validated course. The caller commits (or rolls back for a dry run)."""
    meta = parsed.course
    summary = ImportSummary(slug=meta.slug)
    course = session.scalars(select(Course).where(Course.slug == meta.slug)).one_or_none()
    if course is None:
        course = Course(slug=meta.slug, title=meta.title, short=meta.short, content_hash="")
        session.add(course)
    _set(
        course,
        title=meta.title,
        short=meta.short,
        author=meta.author,
        description=meta.description,
        scheduling=dict(meta.scheduling),
        content_hash=parsed.content_hash,
    )
    session.flush()

    # Units: one row per outline entry; content units carry sections and notes.
    content_units = {u.number: u for u in parsed.units}
    units = {u.number: u for u in session.scalars(select(Unit).where(Unit.course_id == course.id))}
    for position, entry in enumerate(parsed.outline):
        parsed_unit = content_units.get(entry.number)
        unit = units.get(entry.number)
        if unit is None:
            unit = Unit(course_id=course.id, number=entry.number, title=entry.title, position=position)
            session.add(unit)
            units[entry.number] = unit
        changed = _set(
            unit,
            title=parsed_unit.title if parsed_unit else entry.title,
            note_title=parsed_unit.note_title if parsed_unit else None,
            folder=parsed_unit.folder if parsed_unit else None,
            position=position,
            has_content=parsed_unit is not None,
        )
        session.flush()
        if parsed_unit is not None:
            wanted = [(s.key, s.title) for s in parsed_unit.sections]
            if [(s.key, s.title) for s in unit.sections] != wanted:
                unit.sections.clear()
                session.flush()
                unit.sections.extend(
                    SectionRow(key=k, title=t, position=i) for i, (k, t) in enumerate(wanted)
                )
                changed = True
            summary.notes_changed += _sync_notes(session, unit, parsed_unit.notes)
        summary.units_changed += int(changed)

    # Items: identity is the key; unchanged items are not written at all.
    existing = {i.key: i for i in session.scalars(select(Item).where(Item.course_id == course.id))}
    in_files: set[str] = set()
    for pu in parsed.units:
        unit = units[pu.number]
        entries = [(q, "question") for q in pu.questions] + [(x, "exercise") for x in pu.exercises]
        for position, (item, kind) in enumerate(entries):
            in_files.add(item.key)
            summary.kinds[item.key] = kind
            fields = _item_fields(item, kind, unit.id, position)
            row = existing.get(item.key)
            if row is None:
                session.add(Item(course_id=course.id, key=item.key, **fields))
                summary.added.append(item.key)
            elif row.content_hash != fields["content_hash"] or row.retired != fields["retired"]:
                _set(row, **fields)
                summary.changed.append(item.key)
            elif _set(row, unit_id=fields["unit_id"], position=position, kind=kind):
                pass  # moved within the course: updated quietly
            else:
                summary.unchanged += 1
    for key, row in existing.items():
        if key not in in_files and not row.retired:
            row.retired = True
            summary.retired.append(key)

    session.add(
        ImportRun(
            course_id=course.id, content_hash=parsed.content_hash, summary=summary.as_json(), dry_run=dry_run
        )
    )
    session.flush()
    return summary


def _sync_notes(session: Session, unit: Unit, markdown: str | None) -> int:
    notes = session.get(Notes, unit.id)
    if markdown is None:
        if notes is not None:
            session.delete(notes)
            return 1
        return 0
    digest = content_hash(markdown)
    if notes is None:
        session.add(Notes(unit_id=unit.id, markdown=markdown, content_hash=digest))
        return 1
    return int(_set(notes, markdown=markdown, content_hash=digest))


def export_course(session: Session, slug: str) -> ParsedCourse:
    """The stored course as a ParsedCourse (write_course turns it back into files).

    Items retired because they were removed from the files are left out; items marked
    `retired: true` in the files are kept.
    """
    course = session.scalars(select(Course).where(Course.slug == slug)).one()
    meta = CourseMeta(
        slug=course.slug,
        title=course.title,
        short=course.short,
        author=course.author,
        description=course.description,
        scheduling=course.scheduling,  # type: ignore[arg-type]
    )
    units = list(session.scalars(select(Unit).where(Unit.course_id == course.id).order_by(Unit.position)))
    outline = [OutlineEntry(number=u.number, title=u.title) for u in units]
    items = list(session.scalars(select(Item).where(Item.course_id == course.id).order_by(Item.position)))
    parsed_units: list[ParsedUnit] = []
    for unit in units:
        if not unit.has_content:
            continue
        mine = [i for i in items if i.unit_id == unit.id and (not i.retired or i.body.get("retired"))]
        questions = tuple(_QUESTION.validate_python(_from_body(i.body)) for i in mine if i.kind == "question")
        exercises = tuple(Exercise.model_validate(_from_body(i.body)) for i in mine if i.kind == "exercise")
        notes = session.get(Notes, unit.id)
        parsed_units.append(
            ParsedUnit(
                number=unit.number,
                title=unit.title,
                note_title=unit.note_title,
                folder=unit.folder or f"{unit.number:02d}",
                sections=tuple(Section(key=s.key, title=s.title) for s in unit.sections),
                questions=questions,
                exercises=exercises,
                notes=notes.markdown if notes else None,
            )
        )
    return assemble(meta, outline, parsed_units)


def _from_body(body: dict[str, Any]) -> dict[str, Any]:
    rest = dict(body)
    return {"key": rest.pop("id"), **rest}
