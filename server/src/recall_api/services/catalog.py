"""Read-only course queries, shaped the way the web app already uses its content."""

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import not_found
from ..models import Course, Item, Notes, Unit


def get_course(session: Session, slug: str) -> Course:
    course = session.scalars(select(Course).where(Course.slug == slug)).one_or_none()
    if course is None:
        raise not_found("course_not_found", f'No course with slug "{slug}".')
    return course


def list_courses(session: Session) -> list[dict[str, Any]]:
    counts: dict[Any, int] = {
        course_id: n
        for course_id, n in session.execute(
            select(Unit.course_id, func.count()).where(Unit.has_content).group_by(Unit.course_id)
        )
    }
    item_counts: dict[tuple[Any, str], int] = {
        (course_id, kind): n
        for course_id, kind, n in session.execute(
            select(Item.course_id, Item.kind, func.count())
            .where(~Item.retired)
            .group_by(Item.course_id, Item.kind)
        )
    }
    courses = session.scalars(select(Course).order_by(Course.title)).all()
    return [
        {
            "slug": c.slug,
            "title": c.title,
            "short": c.short,
            "author": c.author,
            "description": c.description,
            "unitCount": counts.get(c.id, 0),
            "questionCount": item_counts.get((c.id, "question"), 0),
            "exerciseCount": item_counts.get((c.id, "exercise"), 0),
        }
        for c in courses
    ]


def course_outline(session: Session, slug: str) -> dict[str, Any]:
    course = get_course(session, slug)
    with_notes = set(
        session.scalars(select(Notes.unit_id).join(Unit).where(Unit.course_id == course.id)).all()
    )
    return {
        "slug": course.slug,
        "title": course.title,
        "short": course.short,
        "author": course.author,
        "description": course.description,
        "contentHash": course.content_hash,
        "outline": [
            {
                "number": u.number,
                "title": u.title,
                "hasContent": u.has_content,
                "hasNotes": u.id in with_notes,
            }
            for u in course.units
        ],
    }


def _body(item: Item) -> dict[str, Any]:
    # Items retired because they left the files keep their history; the client hides them.
    return {**item.body, "retired": True} if item.retired and not item.body.get("retired") else item.body


def course_content(session: Session, slug: str) -> tuple[str, list[dict[str, Any]]]:
    """(content hash, chapters) in the web app's Chapter shape."""
    course = get_course(session, slug)
    items = session.scalars(select(Item).where(Item.course_id == course.id).order_by(Item.position)).all()
    chapters: list[dict[str, Any]] = []
    for unit in course.units:
        if not unit.has_content:
            continue
        mine = [i for i in items if i.unit_id == unit.id]
        chapters.append(
            {
                "number": unit.number,
                "title": unit.title,
                "note": unit.note_title,
                "sections": [{"id": s.key, "title": s.title} for s in unit.sections],
                "questions": [_body(i) for i in mine if i.kind == "question"],
                "exercises": [_body(i) for i in mine if i.kind == "exercise"],
            }
        )
    return course.content_hash, chapters


def unit_notes(session: Session, slug: str, number: int) -> dict[str, Any]:
    course = get_course(session, slug)
    unit = next((u for u in course.units if u.number == number), None)
    if unit is None:
        raise not_found("unit_not_found", f"{course.short} has no unit {number}.")
    notes = session.get(Notes, unit.id)
    if notes is None:
        raise not_found("notes_not_found", f"{course.short} unit {number} has no study notes yet.")
    return {"number": unit.number, "markdown": notes.markdown}
