"""The real TLPI course (converted from the web app in T11) parses cleanly."""

from pathlib import Path

import pytest

from recall_content import parse_course

TLPI = Path(__file__).resolve().parents[3] / "courses" / "tlpi"
GOLDEN_NOTES = Path(__file__).parent / "golden" / "ch02-notes.md"


@pytest.mark.skipif(not TLPI.exists(), reason="courses/tlpi not converted yet")
def test_tlpi_parses_with_the_expected_shape() -> None:
    course = parse_course(TLPI)
    assert course.course.slug == "tlpi"
    assert len(course.outline) == 64
    (unit,) = course.units
    assert (unit.number, unit.folder, len(unit.sections), len(unit.questions)) == (
        2,
        "02-fundamental-concepts",
        19,
        50,
    )
    assert unit.notes == GOLDEN_NOTES.read_text()
