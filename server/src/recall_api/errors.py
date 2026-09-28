"""JSON errors: {"error": {"code", "message", "details"?}} with a 4xx/5xx status (SPEC-catalog-api.md)."""

import logging
from typing import Any

from flask import Flask, Response, jsonify
from werkzeug.exceptions import HTTPException, MethodNotAllowed, NotFound

log = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def not_found(code: str, message: str) -> ApiError:
    return ApiError(404, code, message)


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(err: ApiError) -> tuple[Response, int]:
        return jsonify(_body(err.code, err.message, err.details)), err.status

    @app.errorhandler(NotFound)
    def _not_found(_err: NotFound) -> tuple[Response, int]:
        return jsonify(_body("not_found", "There is no API endpoint at this path.")), 404

    @app.errorhandler(MethodNotAllowed)
    def _method(_err: MethodNotAllowed) -> tuple[Response, int]:
        return jsonify(_body("method_not_allowed", "This endpoint doesn't support that HTTP method.")), 405

    @app.errorhandler(HTTPException)
    def _http(err: HTTPException) -> tuple[Response, int]:
        status = err.code or 500
        code = (err.name or "error").lower().replace(" ", "_")
        return jsonify(_body(code, err.description or err.name or "Request failed.")), status

    @app.errorhandler(Exception)
    def _internal(err: Exception) -> tuple[Response, int]:
        log.exception("unhandled error", exc_info=err)
        return jsonify(_body("internal_error", "Something went wrong on the server.")), 500
