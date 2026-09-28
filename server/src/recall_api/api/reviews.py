"""Rating events, previews, suspending and sessions (SPEC-learning-api.md)."""

from typing import Any

from flask import Blueprint

from ..app import get_db, now_ms
from ..schemas.reviews import CardPatch, ReviewRequest, SessionRequest
from ..services import reviews
from ..services.catalog import get_course
from .progress import body

bp = Blueprint("reviews", __name__, url_prefix="/api/courses/<slug>")


@bp.post("/reviews")
def record(slug: str) -> dict[str, Any]:
    db = get_db()
    review, card = reviews.record_review(
        db, get_course(db, slug), ReviewRequest.model_validate(body()), now_ms()
    )
    return {"review": review.out(), "card": card.out()}


@bp.post("/reviews/<review_id>/override")
def override(slug: str, review_id: str) -> dict[str, Any]:
    db = get_db()
    review, card = reviews.override_review(db, get_course(db, slug), review_id, now_ms())
    return {"review": review.out(), "card": card.out()}


@bp.get("/cards/<key>/preview")
def preview(slug: str, key: str) -> dict[str, Any]:
    db = get_db()
    return {r: c.out() for r, c in reviews.preview_card(db, get_course(db, slug), key, now_ms()).items()}


@bp.patch("/cards/<key>")
def patch_card(slug: str, key: str) -> dict[str, Any]:
    db = get_db()
    patch = CardPatch.model_validate(body())
    return reviews.set_suspended(db, get_course(db, slug), key, patch.suspended, now_ms()).out()


@bp.post("/sessions")
def start_session(slug: str) -> dict[str, Any]:
    db = get_db()
    req = SessionRequest.model_validate(body())
    return reviews.start_session(db, get_course(db, slug), req.id, req.mode, now_ms()).out()


@bp.post("/sessions/<session_id>/complete")
def complete_session(slug: str, session_id: str) -> dict[str, Any]:
    db = get_db()
    return reviews.complete_session(db, get_course(db, slug), session_id, now_ms()).out()
