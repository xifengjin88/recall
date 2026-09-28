"""Schema: migrations round-trip, default learner, unique and foreign keys."""

import uuid

import pytest
from alembic import command
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from recall_api.models import DEFAULT_LEARNER_ID, Course, Item, Learner, Unit

from ..conftest import alembic_config


def course(slug: str = "demo") -> Course:
    return Course(slug=slug, title="Demo", short="DEMO", content_hash="sha256:x")


def test_default_learner_exists(db: Session) -> None:
    learner = db.get(Learner, DEFAULT_LEARNER_ID)
    assert learner is not None and learner.name == "default"


def test_migrations_downgrade_and_upgrade_cleanly(engine: Engine) -> None:
    with engine.begin() as conn:
        cfg = alembic_config(conn)
        command.downgrade(cfg, "base")
        assert inspect(conn).get_table_names() == ["alembic_version"]
        command.upgrade(cfg, "head")
        tables = set(inspect(conn).get_table_names())
    assert {"learners", "courses", "units", "sections", "notes", "items", "import_runs"} <= tables


def test_timestamps_are_timestamptz(db: Session) -> None:
    kind = db.execute(
        text(
            "select data_type from information_schema.columns where table_name='items' and column_name='created_at'"
        )
    ).scalar_one()
    assert kind == "timestamp with time zone"


def test_course_slug_is_unique(db: Session) -> None:
    db.add(course())
    db.flush()
    db.add(course())
    with pytest.raises(IntegrityError):
        db.flush()


def test_item_key_unique_per_course_and_needs_a_unit(db: Session) -> None:
    c = course()
    db.add(c)
    db.flush()
    unit = Unit(course_id=c.id, number=1, title="U", position=0, has_content=True)
    db.add(unit)
    db.flush()

    def item(key: str, unit_id: uuid.UUID) -> Item:
        return Item(
            course_id=c.id, unit_id=unit_id, key=key, kind="question", type="single", section_keys=["1.1"],
            difficulty=1, tags=[], body={}, position=0, content_hash="sha256:y",
        )  # fmt: skip

    db.add(item("q1", unit.id))
    db.flush()
    with db.begin_nested():
        db.add(item("q1", unit.id))
        with pytest.raises(IntegrityError):
            db.flush()
    with db.begin_nested():
        db.add(item("q2", uuid.uuid4()))
        with pytest.raises(IntegrityError):
            db.flush()


def test_rolled_back_between_tests(db: Session) -> None:
    assert db.scalars(select(Course)).all() == []
