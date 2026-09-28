from collections.abc import Iterator
from pathlib import Path

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from recall_api.app import create_app
from recall_api.services.content import import_course
from recall_content import parse_course

SERVER = Path(__file__).resolve().parents[2]
TLPI = SERVER.parent / "courses" / "tlpi"
DEMO = SERVER / "tests" / "content" / "fixtures" / "valid-course"


class Clock:
    """A settable "now" (UTC epoch ms) for the app under test."""

    def __init__(self, ms: int) -> None:
        self.ms = ms

    def __call__(self) -> int:
        return self.ms

    def advance(self, minutes: float = 0, days: float = 0) -> None:
        self.ms += round(minutes * 60_000 + days * 86_400_000)


@pytest.fixture
def clock() -> Clock:
    return Clock(1_790_604_000_000)  # 2026-09-28 12:00 UTC


@pytest.fixture
def app(db: Session, clock: Clock) -> Flask:
    """The real app, but every request uses the test's rolled-back session and clock."""
    return create_app(session_factory=lambda: db, clock=clock)


@pytest.fixture
def client(app: Flask) -> Iterator[FlaskClient]:
    with app.test_client() as c:
        yield c


@pytest.fixture
def courses(db: Session) -> None:
    import_course(db, parse_course(TLPI))
    import_course(db, parse_course(DEMO))
    db.flush()
