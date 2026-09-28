"""Today's queue for a course, from recall_engine.today_queue with the learner's cards, clock and limits."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_engine import (
    Card,
    CardKind,
    DoneToday,
    Phase,
    ReviewLog,
    TodayQueue,
    day_start_ms,
    done_today,
    study_day,
    today_queue,
)

from ..errors import ApiError
from ..models import DEFAULT_LEARNER_ID, CardRow, Course, Item, ReviewRow, Section, Unit
from ..timeconv import to_dt, to_ms
from .cards import row_to_card
from .progress import learner_clock
from .reviews import preset_for


@dataclass(frozen=True, slots=True)
class CourseState:
    """What the queue needs, loaded once: active item keys per kind in book order, cards, today's counts."""

    order: dict[CardKind, list[str]]
    cards: dict[str, Card]
    done: dict[CardKind, DoneToday]


def book_order(session: Session, course: Course) -> dict[CardKind, list[str]]:
    """Active items by unit, then the position of their (first) section in the unit, then authored order."""
    sections = {
        (unit_id, key): pos
        for unit_id, key, pos in session.execute(
            select(Section.unit_id, Section.key, Section.position)
            .join(Unit)
            .where(Unit.course_id == course.id)
        )
    }
    rows = session.execute(
        select(Item.key, Item.kind, Item.unit_id, Item.section_keys, Item.position, Unit.number)
        .join(Unit, Item.unit_id == Unit.id)
        .where(Item.course_id == course.id, ~Item.retired)
    ).all()

    def sort_key(r: Any) -> tuple[int, int, int]:
        first: str = r.section_keys[0] if r.section_keys else ""
        return (r.number, sections.get((r.unit_id, first), 0), r.position)

    order: dict[CardKind, list[str]] = {kind: [] for kind in CardKind}
    for r in sorted(rows, key=sort_key):
        order[CardKind(r.kind)].append(r.key)
    return order


def load_state(
    session: Session, course: Course, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> CourseState:
    clock = learner_clock(session, learner_id)
    cards = {
        key: row_to_card(row, key)
        for row, key in session.execute(
            select(CardRow, Item.key)
            .join(Item, CardRow.item_id == Item.id)
            .where(CardRow.learner_id == learner_id, CardRow.course_id == course.id)
        )
    }
    start = day_start_ms(study_day(now, clock), clock)
    todays = session.execute(
        select(ReviewRow.at, ReviewRow.kind, ReviewRow.before).where(
            ReviewRow.learner_id == learner_id,
            ReviewRow.course_id == course.id,
            ReviewRow.at >= to_dt(start),
        )
    ).all()
    logs = [
        ReviewLog(at=to_ms(at), kind=CardKind(kind), phase_before=Phase(before["phase"]))
        for at, kind, before in todays
    ]
    return CourseState(order=book_order(session, course), cards=cards, done=done_today(logs, now, clock))


def queue_for(
    session: Session,
    course: Course,
    state: CourseState,
    kind: CardKind,
    now: int,
    learn_ahead: bool,
    candidates: Sequence[str] | None = None,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> TodayQueue:
    """`candidates` (item keys in the order to introduce new ones) default to every active item in book order."""
    if candidates is None:
        candidates = state.order[kind]
    else:
        active = set(state.order[kind])
        unknown = [k for k in candidates if k not in active]
        if unknown:
            raise ApiError(
                400,
                "invalid_request",
                f"Not active {kind.value}s in {course.short}: {', '.join(unknown[:5])}",
            )
    preset = preset_for(session, course, kind, learner_id)
    return today_queue(candidates, state.cards, now, preset, state.done[kind], learn_ahead)


def queue_out(q: TodayQueue) -> dict[str, list[str]]:
    return {"learning": list(q.learning), "review": list(q.review), "fresh": list(q.fresh)}


def today(
    session: Session, course: Course, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> dict[str, Any]:
    """The course home: question queue (no learn-ahead), exercises due for a redo, the next question due."""
    state = load_state(session, course, now, learner_id)
    questions = queue_for(session, course, state, CardKind.QUESTION, now, False, learner_id=learner_id)
    exercises = queue_for(session, course, state, CardKind.EXERCISE, now, False, learner_id=learner_id)
    active = set(state.order[CardKind.QUESTION])
    upcoming = [
        c.due
        for c in state.cards.values()
        if c.id in active and c.kind is CardKind.QUESTION and not c.suspended and c.phase is not Phase.NEW
        and c.due > now
    ]  # fmt: skip
    return {
        **queue_out(questions),
        "redo": [*exercises.learning, *exercises.review],
        "nextDue": min(upcoming, default=None),
    }


def today_counts(
    session: Session, course: Course, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> dict[str, int]:
    """For the course grid: how many questions are in today's queue, by kind of work."""
    t = today(session, course, now, learner_id)
    return {"learning": len(t["learning"]), "review": len(t["review"]), "fresh": len(t["fresh"])}
