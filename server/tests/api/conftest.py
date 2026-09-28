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


@pytest.fixture
def app(db: Session) -> Flask:
    """The real app, but every request uses the test's rolled-back session."""
    return create_app(session_factory=lambda: db)


@pytest.fixture
def client(app: Flask) -> Iterator[FlaskClient]:
    with app.test_client() as c:
        yield c


@pytest.fixture
def courses(db: Session) -> None:
    import_course(db, parse_course(TLPI))
    import_course(db, parse_course(DEMO))
    db.flush()
