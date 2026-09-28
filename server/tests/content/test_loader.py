"""Parsing a course folder: shapes, line numbers, all errors at once, round trip."""

from pathlib import Path

import pytest

from recall_content import ContentErrors, parse_course, write_course

from .conftest import UNIT, VALID, Edit


def test_valid_course_parses() -> None:
    parsed = parse_course(VALID)
    assert parsed.course.slug == "demo"
    assert [o.number for o in parsed.outline] == [1, 2]
    (unit,) = parsed.units
    assert (unit.number, unit.folder, len(unit.sections)) == (1, "01-basics", 2)
    assert [q.type for q in unit.questions] == [
        "single",
        "multi",
        "truefalse",
        "typed",
        "output",
        "output",
        "order",
        "match",
    ]
    assert unit.exercises[0].tests[1].run == "./hello; echo $?"
    assert unit.notes is not None and unit.notes.startswith("# DEMO 01 - Basics\n")
    assert parsed.content_hash.startswith("sha256:")


def test_notes_are_kept_byte_for_byte() -> None:
    parsed = parse_course(VALID)
    assert parsed.units[0].notes == (VALID / UNIT / "notes.md").read_text()


def errors_of(course: Path) -> list[str]:
    with pytest.raises(ContentErrors) as exc:
        parse_course(course)
    return [str(e) for e in exc.value.errors]


def test_unknown_field_names_file_line_and_suggests(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/questions.yaml", "  hint: One letter.", "  hints: One letter.")
    assert errors_of(course) == [
        f'{UNIT}/questions.yaml:34 demo-q004: unknown field "hints" (did you mean "hint"?)'
    ]


def test_missing_field_and_wrong_type(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/questions.yaml", "  prompt: The sky is green.\n", "")
    edit(f"{UNIT}/questions.yaml", "  difficulty: 2\n  tags: [set]", "  difficulty: 7\n  tags: [set]")
    assert errors_of(course) == [
        f"{UNIT}/questions.yaml:13 demo-q002: difficulty: Input should be 1, 2 or 3",
        f'{UNIT}/questions.yaml:20 demo-q003: missing required field "prompt"',
    ]


def test_all_errors_are_reported_together(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/questions.yaml", "  answer: b\n", "  answer: zzz\n")
    edit(f"{UNIT}/exercises.yaml", "  goal: Print hello.\n", "")
    edit("course.yaml", "short: DEMO\n", "")
    errors = errors_of(course)
    assert len(errors) == 3
    assert 'course.yaml:1: missing required field "short"' in errors


def test_bad_yaml_reports_the_line(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/unit.yaml", "title: Basics", "title: [unclosed")
    (err,) = errors_of(course)
    assert err.startswith(f"{UNIT}/unit.yaml:") and "invalid YAML" in err


def test_unit_folder_without_unit_yaml(course: Path) -> None:
    (course / "units" / "03-empty").mkdir()
    assert errors_of(course) == ["units/03-empty: missing unit.yaml"]


def test_round_trip_is_stable(tmp_path: Path) -> None:
    first = parse_course(VALID)
    write_course(first, tmp_path / "out")
    second = parse_course(tmp_path / "out")
    assert second == first
    assert second.content_hash == first.content_hash
