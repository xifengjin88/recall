"""Exercise state on the server: first touch, tests and hints, skip, redo, rating finishes it."""

from typing import Any

import pytest
from flask.testing import FlaskClient

from .conftest import Clock

pytestmark = pytest.mark.usefixtures("courses")
BASE = "/api/courses/demo"
EX = f"{BASE}/exercises/demo-ex01"


def patch(client: FlaskClient, body: dict[str, Any], status: int = 200) -> dict[str, Any]:
    res = client.patch(EX, json=body)
    assert res.status_code == status, res.json
    assert res.json is not None
    return res.json


def progress(client: FlaskClient) -> dict[str, Any]:
    body = client.get(f"{BASE}/progress").json
    assert body is not None
    return body


def test_first_touch_starts_the_exercise(client: FlaskClient, clock: Clock) -> None:
    state = patch(client, {"notes": "use write(2)"})
    assert state == {
        "status": "in-progress",
        "notes": "use write(2)",
        "attempt": "first",
        "attemptStartedAt": clock.ms,
        "testsPassed": [],
        "hintsRevealed": 0,
        "updatedAt": clock.ms,
    }
    assert progress(client)["exercises"]["demo-ex01"] == state


def test_ticking_tests_and_revealing_hints(client: FlaskClient, clock: Clock) -> None:
    patch(client, {"testsPassed": ["prints hello"]})
    clock.advance(minutes=3)
    state = patch(
        client, {"testsPassed": ["prints hello", "exit status", "prints hello"], "hintsRevealed": 1}
    )
    assert (state["testsPassed"], state["hintsRevealed"], state["attemptStartedAt"]) == (
        ["prints hello", "exit status"],
        1,
        clock.ms - 180_000,  # the attempt started at the first touch
    )


@pytest.mark.parametrize(
    "body",
    [{"testsPassed": ["no such test"]}, {"hintsRevealed": 2}, {"hintsRevealed": -1}, {"status": "finished"}],
)
def test_invalid_changes_are_rejected(client: FlaskClient, body: dict[str, Any]) -> None:
    assert patch(client, body, 400)["error"]["code"] == "invalid_request"


def test_skip_suspends_the_card_and_unskip_resumes_it(client: FlaskClient) -> None:
    assert patch(client, {"status": "skipped"})["status"] == "skipped"
    assert progress(client)["cards"]["demo-ex01"]["suspended"] is True
    patch(client, {"status": "in-progress"})
    assert progress(client)["cards"]["demo-ex01"]["suspended"] is False


def test_rating_an_attempt_marks_it_done(client: FlaskClient) -> None:
    patch(client, {"testsPassed": ["prints hello", "exit status"]})
    res = client.post(
        f"{BASE}/reviews",
        json={"id": "e1", "itemKey": "demo-ex01", "source": "exercise", "rating": "good", "correct": True},
    )
    assert res.status_code == 200
    assert progress(client)["exercises"]["demo-ex01"]["status"] == "done"


def test_redo_resets_tests_and_hints_but_keeps_notes(client: FlaskClient, clock: Clock) -> None:
    patch(client, {"notes": "n", "testsPassed": ["exit status"], "hintsRevealed": 1, "status": "done"})
    clock.advance(minutes=60 * 24 * 3)
    res = client.post(f"{EX}/attempts", json={"mode": "quick"})
    assert res.status_code == 200
    assert res.json == {
        "status": "in-progress",
        "notes": "n",
        "attempt": "quick",
        "attemptStartedAt": clock.ms,
        "testsPassed": [],
        "hintsRevealed": 0,
        "updatedAt": clock.ms,
    }


@pytest.mark.parametrize(
    ("method", "path", "json", "code"),
    [
        ("patch", "/exercises/demo-q001", {"notes": "x"}, "exercise_not_found"),
        ("patch", "/exercises/nope", {"notes": "x"}, "item_not_found"),
        ("post", "/exercises/demo-ex01/attempts", {"mode": "first"}, "invalid_request"),
    ],
)
def test_errors(client: FlaskClient, method: str, path: str, json: Any, code: str) -> None:
    res = getattr(client, method)(f"{BASE}{path}", json=json)
    assert res.json["error"]["code"] == code
