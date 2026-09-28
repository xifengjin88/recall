"""Read-only course endpoints (SPEC-catalog-api.md)."""

import json
from pathlib import Path

import pytest
from flask.testing import FlaskClient

pytestmark = pytest.mark.usefixtures("courses")

WEB_CONTENT = json.loads((Path(__file__).parent / "fixtures" / "tlpi-web-content.json").read_text())


def test_health(client: FlaskClient) -> None:
    assert client.get("/api/health").json == {"ok": True}


def test_course_list(client: FlaskClient) -> None:
    body = client.get("/api/courses").json
    assert body == {
        "courses": [
            {
                "slug": "demo",
                "title": "Demo Course",
                "short": "DEMO",
                "author": "Test Author",
                "description": "A tiny course used by the content tests.",
                "unitCount": 1,
                "questionCount": 8,
                "exerciseCount": 1,
            },
            {
                "slug": "tlpi",
                "title": "The Linux Programming Interface",
                "short": "TLPI",
                "author": "Michael Kerrisk",
                "description": None,
                "unitCount": 1,
                "questionCount": 50,
                "exerciseCount": 0,
            },
        ]
    }


def test_outline_includes_units_without_content(client: FlaskClient) -> None:
    body = client.get("/api/courses/tlpi").json
    assert body is not None
    assert body["slug"] == "tlpi" and body["contentHash"].startswith("sha256:")
    assert len(body["outline"]) == 64
    assert body["outline"][0] == {
        "number": 1,
        "title": "History and Standards",
        "hasContent": False,
        "hasNotes": False,
    }
    assert body["outline"][1] == {
        "number": 2,
        "title": "Fundamental Concepts",
        "hasContent": True,
        "hasNotes": True,
    }


def test_content_matches_what_the_web_app_bundles(client: FlaskClient) -> None:
    """Contract: the web app can swap its bundled content for this response unchanged."""
    body = client.get("/api/courses/tlpi/content").json
    assert body is not None
    assert body["slug"] == "tlpi"
    assert body["chapters"] == WEB_CONTENT["chapters"]


def test_content_etag_and_304(client: FlaskClient) -> None:
    first = client.get("/api/courses/tlpi/content")
    assert first.json is not None
    etag = first.headers["ETag"]
    assert etag == f'"{first.json["contentHash"]}"'
    again = client.get("/api/courses/tlpi/content", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.data == b""


def test_notes(client: FlaskClient) -> None:
    body = client.get("/api/courses/tlpi/units/2/notes").json
    assert body is not None
    assert body["number"] == 2
    assert body["markdown"].startswith("# TLPI 02 - Fundamental Concepts")


@pytest.mark.parametrize(
    ("path", "code"),
    [
        ("/api/courses/nope", "course_not_found"),
        ("/api/courses/nope/content", "course_not_found"),
        ("/api/courses/tlpi/units/99/notes", "unit_not_found"),
        ("/api/courses/tlpi/units/1/notes", "notes_not_found"),
        ("/api/nothing-here", "not_found"),
    ],
)
def test_not_found_errors(client: FlaskClient, path: str, code: str) -> None:
    res = client.get(path)
    assert res.status_code == 404
    assert res.json is not None and res.json["error"]["code"] == code
    assert res.json["error"]["message"]


def test_method_not_allowed(client: FlaskClient) -> None:
    res = client.delete("/api/courses")
    assert res.status_code == 405
    assert res.json is not None and res.json["error"]["code"] == "method_not_allowed"
