"""Notes headings: ids and section extraction match the web app; the two notes rules."""

import json
from pathlib import Path
from typing import Any

import pytest

from recall_content import ContentErrors, parse_course
from recall_content.notes import extract_section, heading_id, note_toc

from .conftest import UNIT, Edit

GOLDEN = Path(__file__).parent / "golden"


@pytest.fixture(scope="module")
def g() -> dict[str, Any]:
    return json.loads((GOLDEN / "notes.json").read_text())


def test_heading_ids_match_web(g: dict[str, Any]) -> None:
    for case in g["headingIds"]:
        assert heading_id(case["text"]) == case["id"], case["text"]


def test_toc_and_sections_of_real_notes_match_web(g: dict[str, Any]) -> None:
    md = (GOLDEN / "ch02-notes.md").read_text()
    assert [{"id": t.id, "text": t.text} for t in note_toc(md)] == g["ch02"]["toc"]
    for case in g["ch02"]["sections"]:
        assert extract_section(md, section=case["section"]) == case["markdown"], case["section"]
    for case in g["ch02"]["anchors"]:
        assert extract_section(md, anchor=case["anchor"]) == case["markdown"], case["anchor"]


def test_hash_inside_code_is_not_a_heading() -> None:
    md = "## 1.1 A\n\n```bash\n# comment\n```\n\n## 1.2 B\n"
    assert extract_section(md, section="1.1") == "## 1.1 A\n\n```bash\n# comment\n```"


def test_missing_section_heading(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/notes.md", "## 1.2 Second section\n", "## Second section\n")
    with pytest.raises(ContentErrors) as exc:
        parse_course(course)
    # "Details" was under 1.2 and still exists, so only the section heading is missing.
    assert [str(e) for e in exc.value.errors] == [f"{UNIT}/notes.md: no heading for section 1.2"]


def test_note_anchor_must_exist(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/questions.yaml", "  note_anchor: Details", "  note_anchor: Missing Heading")
    with pytest.raises(ContentErrors) as exc:
        parse_course(course)
    assert [str(e) for e in exc.value.errors] == [
        f'{UNIT}/questions.yaml:36 demo-q004: note_anchor "Missing Heading" is not a heading in notes.md'
    ]


def test_units_without_notes_skip_the_rules(course: Path) -> None:
    (course / UNIT / "notes.md").unlink()
    assert parse_course(course).units[0].notes is None
