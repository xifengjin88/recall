"""Database fixtures: schema built once from the migrations; every test in a rolled-back transaction."""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.orm import Session

SERVER = Path(__file__).resolve().parents[1]


def _load_dotenv() -> None:
    """Let a bare `uv run pytest` find TEST_DATABASE_URL in the repo's .env."""
    env = SERVER.parent / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()


def alembic_config(connection: Connection) -> AlembicConfig:
    cfg = AlembicConfig(str(SERVER / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER / "migrations"))
    cfg.attributes["connection"] = connection
    return cfg


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set (run `make db` and copy .env.example to .env)")
    eng = create_engine(url)
    with eng.begin() as conn:
        # Start from an empty schema, then build it the same way production does.
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
        command.upgrade(alembic_config(conn), "head")
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """A session inside a transaction that is rolled back after the test."""
    with engine.connect() as conn:
        outer = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
        try:
            yield session
        finally:
            session.close()
            outer.rollback()
