"""Read-only course endpoints (SPEC-catalog-api.md)."""

from typing import Any

from flask import Blueprint, Response, jsonify, request

from ..app import get_db, now_ms
from ..services import catalog

bp = Blueprint("catalog", __name__, url_prefix="/api/courses")


@bp.get("")
def list_courses() -> dict[str, Any]:
    return {"courses": catalog.list_courses(get_db(), now_ms())}


@bp.get("/<slug>")
def outline(slug: str) -> dict[str, Any]:
    return catalog.course_outline(get_db(), slug)


@bp.get("/<slug>/content")
def content(slug: str) -> Response:
    content_hash, chapters = catalog.course_content(get_db(), slug)
    if content_hash in request.if_none_match:
        return Response(status=304, headers={"ETag": f'"{content_hash}"'})
    response = jsonify({"slug": slug, "contentHash": content_hash, "chapters": chapters})
    response.set_etag(content_hash)
    return response


@bp.get("/<slug>/units/<int:number>/notes")
def notes(slug: str, number: int) -> dict[str, Any]:
    return catalog.unit_notes(get_db(), slug, number)
