"""Today's queue and the course home's counts (SPEC-learning-api.md)."""

from typing import Any

from flask import Blueprint

from ..app import get_db, now_ms
from ..schemas.reviews import QueueRequest
from ..services import queue
from ..services.catalog import get_course
from .progress import body

bp = Blueprint("queue", __name__, url_prefix="/api/courses/<slug>")


@bp.post("/queue")
def today_queue(slug: str) -> dict[str, Any]:
    db = get_db()
    course = get_course(db, slug)
    req = QueueRequest.model_validate(body())
    now = now_ms()
    state = queue.load_state(db, course, now)
    kind = queue.CardKind(req.kind)
    return queue.queue_out(queue.queue_for(db, course, state, kind, now, req.learn_ahead, req.candidates))


@bp.get("/today")
def today(slug: str) -> dict[str, Any]:
    db = get_db()
    return queue.today(db, get_course(db, slug), now_ms())
