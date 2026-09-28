"""Progress tables: one card per learner and item, unique review ids, value checks."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import Engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from recall_api.models import DEFAULT_LEARNER_ID, CardRow, Item, ReviewRow
from recall_api.services.content import import_course
from recall_content import parse_course

from ..conftest import alembic_config

DEMO = Path(__file__).resolve().parents[1] / "content" / "fixtures" / "valid-course"
NOW = datetime(2026, 9, 28, 12, tzinfo=UTC)


def an_item(db: Session) -> Item:
    import_course(db, parse_course(DEMO))
    db.flush()
    return db.scalars(select(Item).where(Item.key == "demo-q001")).one()


def card(item: Item, **over: object) -> CardRow:
    values: dict[str, object] = {
        "learner_id": DEFAULT_LEARNER_ID, "item_id": item.id, "course_id": item.course_id, "kind": "question",
        "phase": "review", "step": 0, "due": NOW, "interval_days": 3, "ease": 2.5, "reps": 1, "lapses": 0,
        "last_review": NOW, "last_rating": "good", "leech": False, "suspended": False, "updated_at": NOW,
    }  # fmt: skip
    values.update(over)
    return CardRow(**values)


def review(item: Item, review_id: str = "s1:0", **over: object) -> ReviewRow:
    values: dict[str, object] = {
        "id": review_id, "learner_id": DEFAULT_LEARNER_ID, "course_id": item.course_id, "item_id": item.id,
        "kind": "question", "source": "quiz", "session_id": "s1", "at": NOW, "rating": "good", "correct": True,
        "answer": "b", "hinted": False, "overridden": False, "before": {}, "after": {}, "duration_ms": 1200,
        "meta": None,
    }  # fmt: skip
    values.update(over)
    return ReviewRow(**values)


def test_one_card_per_learner_and_item(db: Session) -> None:
    item = an_item(db)
    db.add(card(item))
    db.flush()
    with db.begin_nested():
        db.add(card(item))
        with pytest.raises(IntegrityError):
            db.flush()


def test_phase_and_rating_are_checked(db: Session) -> None:
    item = an_item(db)
    with db.begin_nested():
        db.add(card(item, phase="forgotten"))
        with pytest.raises(IntegrityError):
            db.flush()
    with db.begin_nested():
        db.add(review(item, rating="meh"))
        with pytest.raises(IntegrityError):
            db.flush()


def test_review_ids_are_unique(db: Session) -> None:
    item = an_item(db)
    db.add(review(item))
    db.flush()
    with db.begin_nested():
        db.add(review(item))
        with pytest.raises(IntegrityError):
            db.flush()


def test_progress_migration_round_trips_with_content_present(engine: Engine) -> None:
    with engine.begin() as conn:
        cfg = alembic_config(conn)
        command.downgrade(cfg, "0001")
        assert "cards" not in inspect(conn).get_table_names()
        command.upgrade(cfg, "head")
        tables = set(inspect(conn).get_table_names())
    assert {
        "cards",
        "reviews",
        "sessions",
        "exercise_states",
        "learner_settings",
        "course_settings",
    } <= tables
