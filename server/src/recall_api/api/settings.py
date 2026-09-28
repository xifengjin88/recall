"""Learner settings, per-course scheduling options and the last unit visited (SPEC-learning-api.md)."""

from typing import Any

from flask import Blueprint

from ..app import get_db
from ..schemas.settings import LastUnit, SchedulingPatch, SettingsPatch
from ..services import settings
from ..services.catalog import get_course
from .progress import body

bp = Blueprint("settings", __name__, url_prefix="/api")


@bp.get("/settings")
def get_settings() -> dict[str, Any]:
    return settings.settings_out(get_db()).out()


@bp.patch("/settings")
def patch_settings() -> dict[str, Any]:
    return settings.update_settings(get_db(), SettingsPatch.model_validate(body())).out()


@bp.get("/courses/<slug>/scheduling")
def get_scheduling(slug: str) -> dict[str, Any]:
    db = get_db()
    return settings.scheduling_out(db, get_course(db, slug)).out()


@bp.patch("/courses/<slug>/scheduling")
def patch_scheduling(slug: str) -> dict[str, Any]:
    db = get_db()
    req = SchedulingPatch.model_validate(body())
    return settings.update_scheduling(db, get_course(db, slug), req).out()


@bp.put("/courses/<slug>/last-unit")
def put_last_unit(slug: str) -> tuple[str, int]:
    db = get_db()
    settings.set_last_unit(db, get_course(db, slug), LastUnit.model_validate(body()).number)
    return "", 204
