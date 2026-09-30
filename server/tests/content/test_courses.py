"""Every course folder in courses/ parses cleanly, so a broken edit fails `make test`, not the import."""

from pathlib import Path

import pytest

from recall_content import parse_course

COURSES = Path(__file__).resolve().parents[3] / "courses"


@pytest.mark.parametrize(
    "folder", sorted(p for p in COURSES.iterdir() if (p / "course.yaml").exists()), ids=str
)
def test_course_parses(folder: Path) -> None:
    course = parse_course(folder)
    assert course.course.slug == folder.name
    assert course.units, "a course needs at least one unit with content"
