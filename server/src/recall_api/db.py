"""Engine and sessions. One session per request (Flask) or per command (CLI), committed as a unit."""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session


def make_engine(url: str) -> Engine:
    return create_engine(url, pool_pre_ping=True)


@contextmanager
def session_scope(engine: Engine) -> Iterator[Session]:
    """A session whose work commits on success and rolls back on error."""
    with Session(engine, expire_on_commit=False) as session, session.begin():
        yield session
