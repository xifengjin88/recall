"""The `recall` command: content validate / import / export, and db upgrade."""

import sys
from pathlib import Path

import click
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy.orm import Session

from recall_content import ContentErrors, parse_course, write_course
from recall_content.schemas import ParsedCourse

from .config import load_config
from .db import make_engine, session_scope
from .services.content import export_course, import_course

SERVER = Path(__file__).resolve().parents[2]


@click.group()
def main() -> None:
    """Recall server tools."""


@main.group()
def content() -> None:
    """Course content files."""


def _parse_or_exit(path: Path) -> ParsedCourse:
    try:
        return parse_course(path)
    except ContentErrors as err:
        for e in err.errors:
            click.echo(str(e), err=True)
        click.echo(f"{len(err.errors)} problem(s) in {path}; nothing was imported.", err=True)
        sys.exit(1)


@content.command()
@click.argument("path", type=click.Path(exists=True, file_okay=False, path_type=Path))
def validate(path: Path) -> None:
    """Check a course folder without touching the database."""
    parsed = _parse_or_exit(path)
    questions = sum(len(u.questions) for u in parsed.units)
    exercises = sum(len(u.exercises) for u in parsed.units)
    units = len(parsed.units)
    click.echo(
        f"OK {parsed.course.slug}: {units} unit{'' if units == 1 else 's'} with content, "
        f"{questions} questions, {exercises} exercises"
    )


@content.command("import")
@click.argument("path", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--dry-run", is_flag=True, help="Show what would change, then roll back.")
def import_(path: Path, dry_run: bool) -> None:
    """Validate a course folder, then upsert it in one transaction."""
    parsed = _parse_or_exit(path)
    engine = make_engine(load_config().database_url)
    with Session(engine, expire_on_commit=False) as session, session.begin() as tx:
        summary = import_course(session, parsed, dry_run=dry_run)
        if dry_run:
            tx.rollback()
    click.echo(summary.describe())
    if dry_run:
        click.echo("dry run: nothing was saved")


@content.command()
@click.argument("slug")
@click.argument("dest", type=click.Path(file_okay=False, path_type=Path))
def export(slug: str, dest: Path) -> None:
    """Write a stored course back out as a course folder."""
    engine = make_engine(load_config().database_url)
    with session_scope(engine) as session:
        parsed = export_course(session, slug)
    write_course(parsed, dest)
    click.echo(f"wrote {dest}")


@main.group()
def db() -> None:
    """Database schema."""


@db.command()
def upgrade() -> None:
    """Apply all migrations (alembic upgrade head)."""
    cfg = AlembicConfig(str(SERVER / "alembic.ini"))
    cfg.set_main_option("script_location", str(SERVER / "migrations"))
    cfg.attributes["url"] = load_config().database_url
    command.upgrade(cfg, "head")
    click.echo("database is up to date")
