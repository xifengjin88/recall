"""A learner's work on an exercise: tests ticked, hints shown, notes, skipping, redo attempts.

Rating an attempt is a review (services/reviews.py), which also marks the exercise done.
"""

import uuid
from dataclasses import replace

from sqlalchemy.orm import Session

from recall_engine import CardKind

from ..errors import ApiError
from ..models import DEFAULT_LEARNER_ID, Course, Item
from ..schemas.progress import ExerciseStateOut
from ..schemas.reviews import AttemptRequest, ExercisePatch
from ..timeconv import to_dt
from .progress import exercise_out, exercise_row
from .reviews import current_card, get_item, preset_for, store_card


def get_exercise(session: Session, course: Course, key: str) -> Item:
    item = get_item(session, course, key)
    if item.kind != CardKind.EXERCISE.value:
        raise ApiError(404, "exercise_not_found", f'"{key}" is a question, not an exercise.')
    return item


def _check(item: Item, patch: ExercisePatch) -> None:
    tests = {t["name"] for t in item.body.get("tests", [])}
    unknown = [n for n in patch.tests_passed or [] if n not in tests]
    if unknown:
        raise ApiError(
            400, "invalid_request", f"{item.key} has no test named {', '.join(map(repr, unknown))}."
        )
    hints = len(item.body.get("hints", []))
    if patch.hints_revealed is not None and patch.hints_revealed > hints:
        raise ApiError(400, "invalid_request", f"{item.key} has {hints} hint{'s' if hints != 1 else ''}.")


def _set_suspended(
    session: Session, course: Course, item: Item, suspended: bool, now: int, learner_id: uuid.UUID
) -> None:
    preset = preset_for(session, course, CardKind.EXERCISE, learner_id)
    card, row = current_card(session, item, preset, learner_id)
    if card.suspended != suspended:
        store_card(session, item, replace(card, suspended=suspended, updated_at=now), row, learner_id)


def patch_exercise(
    session: Session,
    course: Course,
    key: str,
    patch: ExercisePatch,
    now: int,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> ExerciseStateOut:
    """Apply the fields sent. Touching a not-started exercise starts it; skipping suspends its card."""
    item = get_exercise(session, course, key)
    _check(item, patch)
    row = exercise_row(session, item, learner_id, now)
    was = row.status
    sent = patch.model_fields_set
    if patch.status is not None:
        row.status = patch.status
    if patch.notes is not None:
        row.notes = patch.notes
    if patch.tests_passed is not None:
        row.tests_passed = list(dict.fromkeys(patch.tests_passed))
    if patch.hints_revealed is not None:
        row.hints_revealed = patch.hints_revealed
    if "status" not in sent and row.status == "not-started":
        row.status = "in-progress"
    if row.attempt_started_at is None and row.status == "in-progress":
        row.attempt_started_at = to_dt(now)
    row.updated_at = to_dt(now)
    if (row.status == "skipped") != (was == "skipped"):
        _set_suspended(session, course, item, row.status == "skipped", now, learner_id)
    session.flush()
    return exercise_out(row)


def start_attempt(
    session: Session,
    course: Course,
    key: str,
    req: AttemptRequest,
    now: int,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> ExerciseStateOut:
    """Begin a redo or quick review: tests and hints reset, notes kept."""
    item = get_exercise(session, course, key)
    row = exercise_row(session, item, learner_id, now)
    row.status = "in-progress"
    row.attempt = req.mode
    row.attempt_started_at = to_dt(now)
    row.tests_passed = []
    row.hints_revealed = 0
    row.updated_at = to_dt(now)
    session.flush()
    return exercise_out(row)
