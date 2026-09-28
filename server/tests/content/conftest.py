import shutil
from collections.abc import Callable
from pathlib import Path

import pytest

VALID = Path(__file__).parent / "fixtures" / "valid-course"
UNIT = "units/01-basics"


@pytest.fixture
def course(tmp_path: Path) -> Path:
    """A fresh copy of the valid fixture course that a test may break."""
    dest = tmp_path / "demo"
    shutil.copytree(VALID, dest)
    return dest


Edit = Callable[[str, str, str], None]


@pytest.fixture
def edit(course: Path) -> Edit:
    """Replace text in one file of the course copy (exactly once)."""

    def apply(rel: str, old: str, new: str) -> None:
        path = course / rel
        text = path.read_text()
        assert text.count(old) == 1, f"{old!r} must appear exactly once in {rel}"
        path.write_text(text.replace(old, new))

    return apply
