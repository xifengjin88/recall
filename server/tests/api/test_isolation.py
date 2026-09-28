"""Each course keeps its own study state (SPEC.md: no cross-course sessions)."""

from typing import Any

import pytest
from flask.testing import FlaskClient

pytestmark = pytest.mark.usefixtures("courses")
DEMO = "/api/courses/demo"
TLPI = "/api/courses/tlpi"


def ok(res: Any, status: int = 200) -> Any:
    assert res.status_code == status, res.json
    return res.json


def test_state_in_one_course_never_touches_another(client: FlaskClient) -> None:
    before = ok(client.get(f"{TLPI}/progress"))
    tlpi_scheduling = ok(client.get(f"{TLPI}/scheduling"))

    # everything a learner can do in the demo course
    ok(client.post(f"{DEMO}/sessions", json={"id": "s1", "mode": "quiz"}))
    body = {"id": "r1", "itemKey": "demo-q001", "source": "quiz", "sessionId": "s1", "rating": "again"}
    ok(client.post(f"{DEMO}/reviews", json={**body, "correct": False}))
    ok(client.post(f"{DEMO}/sessions/s1/complete"))
    ok(client.patch(f"{DEMO}/exercises/demo-ex01", json={"notes": "x", "status": "skipped"}))
    ok(client.patch(f"{DEMO}/scheduling", json={"kind": "question", "changes": {"newPerDay": 1}}))
    ok(client.put(f"{DEMO}/last-unit", json={"number": 1}), 204)

    after = ok(client.get(f"{TLPI}/progress"))
    assert after == before
    assert ok(client.get(f"{TLPI}/scheduling")) == tlpi_scheduling
    assert len(ok(client.get(f"{TLPI}/today"))["fresh"]) == 20  # its own new/day, not demo's override

    # a review id is global, so reusing one in another course is refused rather than merged
    res = client.post(
        f"{TLPI}/reviews", json={**body, "itemKey": "ch02-q001", "correct": True, "rating": "good"}
    )
    assert ok(res, 409)["error"]["code"] == "review_id_conflict"

    # resetting the demo course leaves TLPI alone too
    ok(client.delete(f"{DEMO}/progress"))
    assert ok(client.get(f"{TLPI}/progress")) == before
