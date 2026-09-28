"""Progress load / import / export / reset (SPEC-learning-api.md)."""

from typing import Any

from flask import Blueprint, request

from ..app import get_db
from ..errors import ApiError
from ..schemas.progress import ImportRequest
from ..services import progress
from ..services.catalog import get_course

bp = Blueprint("progress", __name__, url_prefix="/api/courses/<slug>")


def body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_request", "Send a JSON object.")
    return data  # pyright: ignore[reportUnknownVariableType]


@bp.get("/progress")
def load(slug: str) -> dict[str, Any]:
    db = get_db()
    return progress.load_progress(db, get_course(db, slug)).out()


@bp.put("/progress")
def import_(slug: str) -> dict[str, Any]:
    db = get_db()
    req = ImportRequest.model_validate(body())
    data, skipped = progress.import_progress(db, get_course(db, slug), req.file, req.mode)
    return {"progress": data.out(), "skipped": skipped}


@bp.get("/progress/export")
def export(slug: str) -> dict[str, Any]:
    db = get_db()
    return progress.export_progress(db, get_course(db, slug))


@bp.delete("/progress")
def reset(slug: str) -> dict[str, Any]:
    db = get_db()
    unit = request.args.get("unit", type=int)
    return progress.reset_progress(db, get_course(db, slug), unit).out()
