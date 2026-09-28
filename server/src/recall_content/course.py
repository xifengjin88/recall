"""parse_course: a course folder → ParsedCourse, or ContentErrors listing every problem."""

from pathlib import Path
from typing import Any

from .errors import ContentError, ContentErrors
from .hashing import content_hash
from .loader import UNIT_FOLDER, Located, load_list, load_model
from .rules import (
    check_course,
    check_exercise,
    check_notes,
    check_question,
    check_sections,
    check_unique_keys,
)
from .schemas import CourseFile, CourseMeta, ParsedCourse, ParsedUnit, UnitFile


def parse_course(root: Path) -> ParsedCourse:
    errors: list[ContentError] = []
    loaded = load_model(root / "course.yaml", "course.yaml", CourseFile, errors)
    course = loaded[0] if loaded else None
    if loaded:
        errors.extend(check_course(*loaded))

    units: list[ParsedUnit] = []
    all_items: list[Located[Any]] = []
    unit_numbers: dict[int, str] = {}
    units_dir = root / "units"
    folders = sorted(p for p in units_dir.iterdir() if p.is_dir()) if units_dir.exists() else []
    for folder in folders:
        rel = f"units/{folder.name}"
        if not (folder / "unit.yaml").exists():
            errors.append(ContentError(rel, None, None, "missing unit.yaml"))
            continue
        loaded_unit = load_model(folder / "unit.yaml", f"{rel}/unit.yaml", UnitFile, errors)
        questions = load_list(folder, "questions.yaml", rel, "question", errors)
        exercises = load_list(folder, "exercises.yaml", rel, "exercise", errors)
        all_items.extend(questions)
        all_items.extend(exercises)
        if loaded_unit is None:
            continue
        unit, unit_doc = loaded_unit

        match = UNIT_FOLDER.match(folder.name)
        if not match:
            errors.append(
                ContentError(
                    rel, None, None, "unit folder names look like NN-title, e.g. 02-fundamental-concepts"
                )
            )
        elif int(match.group(1)) != unit.number:
            errors.append(
                ContentError(
                    rel,
                    None,
                    None,
                    f"folder number {match.group(1)} does not match unit.yaml number {unit.number}",
                )
            )
        if unit.number in unit_numbers:
            errors.append(
                ContentError(
                    rel, None, None, f"unit number {unit.number} is also used by {unit_numbers[unit.number]}"
                )
            )
        unit_numbers[unit.number] = rel
        if course and unit.number not in {o.number for o in course.outline}:
            errors.append(
                ContentError(
                    rel,
                    None,
                    None,
                    f"unit folder has number {unit.number}, which is not in course.yaml outline",
                )
            )
        errors.extend(check_sections(unit, f"{rel}/unit.yaml", unit_doc))
        for q in questions:
            errors.extend(check_question(q, unit))
        for x in exercises:
            errors.extend(check_exercise(x, unit))

        notes_path = folder / "notes.md"
        notes = notes_path.read_text() if notes_path.exists() else None
        if notes is not None:
            errors.extend(check_notes(notes, unit, rel, [*questions, *exercises]))
        units.append(
            ParsedUnit(
                number=unit.number,
                title=unit.title,
                note_title=unit.note_title,
                folder=folder.name,
                sections=unit.sections,
                questions=tuple(q.item for q in questions),
                exercises=tuple(x.item for x in exercises),
                notes=notes,
            )
        )

    errors.extend(check_unique_keys(all_items))
    if errors or course is None:
        raise ContentErrors(errors)

    meta = CourseMeta(
        slug=course.slug,
        title=course.title,
        short=course.short,
        author=course.author,
        description=course.description,
        scheduling=course.scheduling,
    )
    body = {"course": meta, "outline": course.outline, "units": tuple(units)}
    return ParsedCourse(
        **body, content_hash=content_hash(ParsedCourse.model_construct(**body, content_hash=""))
    )
