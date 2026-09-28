"""Applying ratings with recall_engine: reviews, overrides, previews, suspending, sessions.

The server is the source of truth for scheduling (SPEC-learning-api.md): it loads the card, runs
the engine with the learner's clock and the course's resolved preset, and stores the result.
"""

import uuid
from dataclasses import replace
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_engine import Card, CardKind, Preset, Rating, answer, new_card, preview, resolve_preset, study_day

from ..errors import ApiError
from ..models import DEFAULT_LEARNER_ID, CardRow, Course, Item, ReviewRow, SessionRow
from ..schemas.progress import CardOut, ReviewOut, SessionOut
from ..schemas.reviews import ReviewRequest
from ..timeconv import to_dt, to_ms, to_ms_opt
from .cards import card_from_out, card_out, card_to_row_values, row_to_card
from .progress import course_settings, exercise_row, learner_clock


def get_item(session: Session, course: Course, key: str) -> Item:
    item = session.scalars(select(Item).where(Item.course_id == course.id, Item.key == key)).one_or_none()
    if item is None:
        raise ApiError(404, "item_not_found", f'{course.short} has no question or exercise "{key}".')
    return item


def preset_for(
    session: Session, course: Course, kind: CardKind, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> Preset:
    """Engine defaults, then the course's defaults (course.yaml), then the learner's overrides."""
    course_layer: dict[str, Any] = course.scheduling.get(kind.value, {})
    learner_layer: dict[str, Any] = course_settings(session, course, learner_id).scheduling.get(
        kind.value, {}
    )
    return resolve_preset(kind, course_layer, learner_layer)


def current_card(
    session: Session, item: Item, preset: Preset, learner_id: uuid.UUID
) -> tuple[Card, CardRow | None]:
    row = session.get(CardRow, (learner_id, item.id))
    if row is None:
        return new_card(item.key, CardKind(item.kind), preset), None
    return row_to_card(row, item.key), row


def store_card(session: Session, item: Item, card: Card, row: CardRow | None, learner_id: uuid.UUID) -> None:
    values = card_to_row_values(card)
    if row is None:
        session.add(CardRow(learner_id=learner_id, item_id=item.id, course_id=item.course_id, **values))
    else:
        for name, value in values.items():
            setattr(row, name, value)


def review_out(row: ReviewRow, key: str) -> ReviewOut:
    return ReviewOut(
        id=row.id,
        card_id=key,
        kind=row.kind,  # type: ignore[arg-type]
        source=row.source,  # type: ignore[arg-type]
        session_id=row.session_id,
        at=to_ms(row.at),
        rating=row.rating,  # type: ignore[arg-type]
        correct=row.correct,
        answer=row.answer,
        hinted=row.hinted,
        overridden=row.overridden,
        before=row.before,
        after=row.after,
        duration_ms=row.duration_ms,
        meta=row.meta,
    )


def record_review(
    session: Session, course: Course, req: ReviewRequest, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> tuple[ReviewOut, CardOut]:
    """Rate a card. A repeated review id returns the stored result without applying it again."""
    item = get_item(session, course, req.item_key)
    existing = session.get(ReviewRow, req.id)
    if existing is not None:
        if existing.item_id != item.id or existing.learner_id != learner_id:
            raise ApiError(
                409, "review_id_conflict", f'Review id "{req.id}" is already used for another card.'
            )
        card, _ = current_card(
            session, item, preset_for(session, course, CardKind(item.kind), learner_id), learner_id
        )
        return review_out(existing, item.key), card_out(card)

    kind = CardKind(item.kind)
    preset = preset_for(session, course, kind, learner_id)
    before, row = current_card(session, item, preset, learner_id)
    after = answer(before, Rating(req.rating), now, preset, learner_clock(session, learner_id))
    store_card(session, item, after, row, learner_id)
    review = ReviewRow(
        id=req.id,
        learner_id=learner_id,
        course_id=course.id,
        item_id=item.id,
        kind=kind.value,
        source=req.source,
        session_id=req.session_id,
        at=to_dt(now),
        rating=req.rating,
        correct=req.correct,
        answer=req.answer,
        hinted=req.hinted,
        overridden=False,
        before=card_out(before).out(),
        after=card_out(after).out(),
        duration_ms=req.duration_ms,
        meta=req.meta,
    )
    session.add(review)
    if kind is CardKind.EXERCISE:  # rating an attempt finishes it
        state = exercise_row(session, item, learner_id, now)
        state.status = "done"
        state.updated_at = to_dt(now)
    session.flush()
    return review_out(review, item.key), card_out(after)


def override_review(
    session: Session, course: Course, review_id: str, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> tuple[ReviewOut, CardOut]:
    """ "I was right": re-rate as Hard (correct, overridden) from the card as it was before the review."""
    row = session.get(ReviewRow, review_id)
    if row is None or row.course_id != course.id or row.learner_id != learner_id:
        raise ApiError(404, "review_not_found", f'No review "{review_id}" in {course.short}.')
    item = session.get(Item, row.item_id)
    assert item is not None
    if row.overridden:
        card, _ = current_card(
            session, item, preset_for(session, course, CardKind(item.kind), learner_id), learner_id
        )
        return review_out(row, item.key), card_out(card)
    try:
        before = card_from_out(CardOut.model_validate(row.before))
    except ValidationError as err:
        raise ApiError(
            409, "cannot_override", "This review came from an old import and can't be re-rated."
        ) from err
    kind = CardKind(item.kind)
    preset = preset_for(session, course, kind, learner_id)
    after = answer(before, Rating.HARD, now, preset, learner_clock(session, learner_id))
    _, card_row = current_card(session, item, preset, learner_id)
    store_card(session, item, after, card_row, learner_id)
    row.rating = Rating.HARD.value
    row.correct = True
    row.overridden = True
    row.after = card_out(after).out()
    session.flush()
    return review_out(row, item.key), card_out(after)


def preview_card(
    session: Session, course: Course, key: str, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> dict[str, CardOut]:
    item = get_item(session, course, key)
    kind = CardKind(item.kind)
    preset = preset_for(session, course, kind, learner_id)
    card, _ = current_card(session, item, preset, learner_id)
    return {
        r.value: card_out(c)
        for r, c in preview(card, now, preset, learner_clock(session, learner_id)).items()
    }


def set_suspended(
    session: Session,
    course: Course,
    key: str,
    suspended: bool,
    now: int,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> CardOut:
    item = get_item(session, course, key)
    preset = preset_for(session, course, CardKind(item.kind), learner_id)
    card, row = current_card(session, item, preset, learner_id)

    updated = replace(card, suspended=suspended, updated_at=now)
    store_card(session, item, updated, row, learner_id)
    session.flush()
    return card_out(updated)


# ---- sessions ----------------------------------------------------------------------


def session_out(row: SessionRow) -> SessionOut:
    return SessionOut(
        id=row.id,
        mode=row.mode,  # type: ignore[arg-type]
        started_at=to_ms(row.started_at),
        completed_at=to_ms_opt(row.completed_at),
        completed_day=row.completed_day.isoformat() if row.completed_day else None,
    )


def start_session(
    session: Session,
    course: Course,
    session_id: str,
    mode: str,
    now: int,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> SessionOut:
    row = session.get(SessionRow, session_id)
    if row is None:
        row = SessionRow(
            id=session_id, learner_id=learner_id, course_id=course.id, mode=mode, started_at=to_dt(now)
        )
        session.add(row)
        session.flush()
    elif row.course_id != course.id:
        raise ApiError(409, "session_id_conflict", f'Session id "{session_id}" belongs to another course.')
    return session_out(row)


def complete_session(
    session: Session, course: Course, session_id: str, now: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> SessionOut:
    row = session.get(SessionRow, session_id)
    if row is None or row.course_id != course.id or row.learner_id != learner_id:
        raise ApiError(404, "session_not_found", f'No session "{session_id}" in {course.short}.')
    if row.completed_at is None:
        row.completed_at = to_dt(now)
        row.completed_day = study_day(now, learner_clock(session, learner_id))
        session.flush()
    return session_out(row)
