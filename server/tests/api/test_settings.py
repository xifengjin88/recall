"""Learner settings, per-course scheduling options and the last unit (SPEC-learning-api.md)."""

from typing import Any

import pytest
from flask.testing import FlaskClient

from .conftest import Clock

pytestmark = pytest.mark.usefixtures("courses")
BASE = "/api/courses/demo"


def ok(res: Any, status: int = 200) -> Any:
    assert res.status_code == status, res.json
    return res.json


def test_settings_defaults_and_patch(client: FlaskClient) -> None:
    assert ok(client.get("/api/settings")) == {
        "theme": "system",
        "showKeyHints": True,
        "timeZone": "UTC",
        "prefs": {"length": 10, "order": "shuffled", "types": [], "difficulty": 0},
    }
    body = ok(client.patch("/api/settings", json={"theme": "dark", "timeZone": "Asia/Tokyo"}))
    assert (body["theme"], body["timeZone"], body["showKeyHints"]) == ("dark", "Asia/Tokyo", True)
    prefs = {"length": "all", "order": "book", "types": ["single"], "difficulty": 2}
    assert ok(client.patch("/api/settings", json={"prefs": prefs}))["prefs"] == prefs
    settings = ok(client.get(f"{BASE}/progress"))["settings"]
    assert (settings["theme"], settings["timeZone"]) == ("dark", "Asia/Tokyo")


@pytest.mark.parametrize(
    "body",
    [
        {"timeZone": "Mars/Olympus"},
        {"timeZone": "../../etc/passwd"},
        {"theme": "blue"},
        {"prefs": {"length": 7}},
        {"fontSize": 3},
    ],
)
def test_bad_settings_are_rejected(client: FlaskClient, body: dict[str, Any]) -> None:
    assert ok(client.patch("/api/settings", json=body), 400)["error"]["code"] == "invalid_request"


def test_the_time_zone_moves_day_boundaries(client: FlaskClient, clock: Clock) -> None:
    # 2026-09-28 20:00 UTC is 05:00 JST on the 29th: past Tokyo's 04:00 rollover, not yet UTC's.
    clock.ms = 1_790_625_600_000
    ok(client.post(f"{BASE}/sessions", json={"id": "utc", "mode": "quiz"}))
    assert ok(client.post(f"{BASE}/sessions/utc/complete"))["completedDay"] == "2026-09-28"
    ok(client.patch("/api/settings", json={"timeZone": "Asia/Tokyo"}))
    ok(client.post(f"{BASE}/sessions", json={"id": "tokyo", "mode": "quiz"}))
    assert ok(client.post(f"{BASE}/sessions/tokyo/complete"))["completedDay"] == "2026-09-29"


def test_scheduling_layers(client: FlaskClient) -> None:
    body = ok(client.get(f"{BASE}/scheduling"))
    # the demo course.yaml sets newPerDay 5 for questions
    assert body["defaults"]["question"]["newPerDay"] == 5
    assert body["defaults"]["question"]["learnSteps"] == [1, 10]
    assert body["overrides"] == {}
    assert body["effective"] == body["defaults"]

    body = ok(
        client.patch(
            f"{BASE}/scheduling",
            json={"kind": "question", "changes": {"learnSteps": [2, 20, 1440], "startingEase": 2.3}},
        )
    )
    assert body["overrides"] == {"question": {"learnSteps": [2, 20, 1440], "startingEase": 2.3}}
    assert body["effective"]["question"]["learnSteps"] == [2, 20, 1440]
    assert body["effective"]["exercise"] == body["defaults"]["exercise"]
    assert ok(client.get(f"{BASE}/progress"))["settings"]["scheduling"] == body["overrides"]

    body = ok(
        client.patch(f"{BASE}/scheduling", json={"kind": "question", "changes": {"startingEase": None}})
    )
    assert body["overrides"] == {"question": {"learnSteps": [2, 20, 1440]}}
    body = ok(client.patch(f"{BASE}/scheduling", json={"kind": "question", "changes": None}))
    assert body["overrides"] == {}


def test_overrides_change_what_the_engine_schedules(client: FlaskClient, clock: Clock) -> None:
    ok(client.patch(f"{BASE}/scheduling", json={"kind": "question", "changes": {"learnSteps": [5]}}))
    card = ok(
        client.post(
            f"{BASE}/reviews",
            json={"id": "r", "itemKey": "demo-q001", "source": "quiz", "rating": "again", "correct": False},
        )
    )["card"]
    assert card["due"] == clock.ms + 5 * 60_000


@pytest.mark.parametrize(
    "changes",
    [
        {"startingEase": 1.2},
        {"newPerDay": -1},
        {"learnSteps": [0]},
        {"graduatingInterval": 0},
        {"lapseFactor": 1.5},
        {"minInterval": 200, "maxInterval": 100},
        {"bogus": 1},
    ],
)
def test_bad_scheduling_is_rejected(client: FlaskClient, changes: dict[str, Any]) -> None:
    res = client.patch(f"{BASE}/scheduling", json={"kind": "question", "changes": changes})
    assert ok(res, 400)["error"]["code"] == "invalid_request"
    assert ok(client.get(f"{BASE}/scheduling"))["overrides"] == {}


def test_last_unit(client: FlaskClient) -> None:
    ok(client.put(f"{BASE}/last-unit", json={"number": 1}), 204)
    assert ok(client.get(f"{BASE}/progress"))["lastChapter"] == 1
    assert ok(client.put(f"{BASE}/last-unit", json={"number": 99}), 404)["error"]["code"] == "unit_not_found"
