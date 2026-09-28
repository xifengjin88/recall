"""Exercise state: tests, hints, notes, skipping and redo attempts (SPEC-learning-api.md)."""

from typing import Any

from flask import Blueprint

from ..app import get_db, now_ms
from ..schemas.reviews import AttemptRequest, ExercisePatch
from ..services import exercises
from ..services.catalog import get_course
from .progress import body

bp = Blueprint("exercises", __name__, url_prefix="/api/courses/<slug>/exercises")


@bp.patch("/<key>")
def patch(slug: str, key: str) -> dict[str, Any]:
    db = get_db()
    req = ExercisePatch.model_validate(body())
    return exercises.patch_exercise(db, get_course(db, slug), key, req, now_ms()).out()


@bp.post("/<key>/attempts")
def attempt(slug: str, key: str) -> dict[str, Any]:
    db = get_db()
    req = AttemptRequest.model_validate(body())
    return exercises.start_attempt(db, get_course(db, slug), key, req, now_ms()).out()
