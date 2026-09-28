"""Importing course folders into Postgres (SPEC-content-import.md)."""

import os
import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from click.testing import CliRunner
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from recall_api.cli import main
from recall_api.models import Course, ImportRun, Item, Notes, Unit
from recall_api.services.content import export_course, import_course
from recall_content import parse_course

SERVER = Path(__file__).resolve().parents[2]
TLPI = SERVER.parent / "courses" / "tlpi"
FIXTURE = SERVER / "tests" / "content" / "fixtures" / "valid-course"


@contextmanager
def item_writes(db: Session) -> Iterator[list[str]]:
    """Collect every INSERT/UPDATE/DELETE statement that touches the items table."""
    seen: list[str] = []

    def listener(_conn: Any, _cursor: Any, statement: str, *_args: Any) -> None:
        head = statement.lstrip().upper()
        if head.startswith(("INSERT INTO ITEMS", "UPDATE ITEMS", "DELETE FROM ITEMS")):
            seen.append(statement)

    bind = db.connection()
    event.listen(bind, "before_cursor_execute", listener)
    try:
        yield seen
    finally:
        event.remove(bind, "before_cursor_execute", listener)


def test_first_import_adds_everything_second_changes_nothing(db: Session) -> None:
    parsed = parse_course(TLPI)
    first = import_course(db, parsed)
    assert (len(first.added), len(first.changed), len(first.retired), first.unchanged) == (50, 0, 0, 0)
    db.flush()
    with item_writes(db) as writes:
        second = import_course(db, parsed)
        db.flush()
    assert (len(second.added), len(second.changed), len(second.retired), second.unchanged) == (0, 0, 0, 50)
    assert writes == []
    course = db.scalars(select(Course).where(Course.slug == "tlpi")).one()
    units = db.scalars(select(Unit).where(Unit.course_id == course.id).order_by(Unit.number)).all()
    assert len(units) == 64
    assert [u.number for u in units if u.has_content] == [2]
    assert db.get(Notes, units[1].id) is not None
    assert len(db.scalars(select(ImportRun).where(ImportRun.course_id == course.id)).all()) == 2


def test_body_is_api_ready(db: Session) -> None:
    import_course(db, parse_course(TLPI))
    item = db.scalars(select(Item).where(Item.key == "ch02-q014")).one()
    assert item.body["id"] == "ch02-q014"
    assert "key" not in item.body
    assert item.body["code"] == {"lang": "bash", "source": "$ cd /\n$ cd ..\n$ pwd"}
    assert (item.kind, item.type, item.section_keys) == ("question", "output", ["2.4"])


def copy_course(tmp_path: Path) -> Path:
    dest = tmp_path / "demo"
    shutil.copytree(FIXTURE, dest)
    return dest


def test_edit_one_retire_one_restore_one(db: Session, tmp_path: Path) -> None:
    course_dir = copy_course(tmp_path)
    import_course(db, parse_course(course_dir))
    questions = course_dir / "units" / "01-basics" / "questions.yaml"
    original = questions.read_text()

    edited = original.replace("prompt: Pick **b**.", "prompt: Pick **b**, please.")
    # Drop demo-q003 entirely.
    start = edited.index("- key: demo-q003")
    end = edited.index("- key: demo-q004")
    questions.write_text(edited[:start] + edited[end:])
    summary = import_course(db, parse_course(course_dir))
    assert (summary.changed, summary.retired, len(summary.added)) == (["demo-q001"], ["demo-q003"], 0)
    retired = db.scalars(select(Item).where(Item.key == "demo-q003")).one()
    assert retired.retired is True

    questions.write_text(original)
    restored = import_course(db, parse_course(course_dir))
    assert sorted(restored.changed) == ["demo-q001", "demo-q003"]
    assert db.scalars(select(Item).where(Item.key == "demo-q003")).one().retired is False


def test_export_round_trips(db: Session, tmp_path: Path) -> None:
    parsed = parse_course(TLPI)
    import_course(db, parsed)
    assert export_course(db, "tlpi") == parsed


# ---- CLI ---------------------------------------------------------------------------


def test_cli_validate_ok_and_errors(tmp_path: Path) -> None:
    runner = CliRunner()
    ok = runner.invoke(main, ["content", "validate", str(TLPI)])
    assert ok.exit_code == 0, ok.output
    assert "OK tlpi: 1 unit with content, 50 questions, 0 exercises" in ok.output

    broken = copy_course(tmp_path)
    q = broken / "units" / "01-basics" / "questions.yaml"
    q.write_text(q.read_text().replace("  answer: b\n", "  answer: zzz\n"))
    bad = runner.invoke(main, ["content", "validate", str(broken)])
    assert bad.exit_code == 1
    assert 'demo-q001: answer "zzz" is not among the options' in bad.output


def test_cli_import_dry_run_writes_nothing() -> None:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    result = CliRunner().invoke(
        main, ["content", "import", str(FIXTURE), "--dry-run"], env={"DATABASE_URL": url}
    )
    assert result.exit_code == 0, result.output
    assert "added 8 questions, 1 exercise" in result.output
    assert "dry run: nothing was saved" in result.output


def test_cli_import_invalid_course_exits_1(tmp_path: Path) -> None:
    broken = copy_course(tmp_path)
    (broken / "course.yaml").write_text("slug: demo\n")
    result = CliRunner().invoke(
        main, ["content", "import", str(broken)], env={"DATABASE_URL": "postgresql+psycopg://unused"}
    )
    assert result.exit_code == 1
    assert 'course.yaml:1: missing required field "title"' in result.output
