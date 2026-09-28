"""Today's queue and course counts from the server (SPEC-learning-api.md)."""

from typing import Any

import pytest
from flask.testing import FlaskClient

from .conftest import Clock

pytestmark = pytest.mark.usefixtures("courses")
BASE = "/api/courses/demo"
DAY = 24 * 60


def ok(res: Any, status: int = 200) -> Any:
    assert res.status_code == status, res.json
    return res.json


def rate(client: FlaskClient, rid: str, key: str, rating: str, base: str = BASE) -> Any:
    source = "exercise" if "-ex" in key else "quiz"
    body = {"id": rid, "itemKey": key, "source": source, "rating": rating, "correct": rating != "again"}
    return ok(client.post(f"{base}/reviews", json=body))


def queue(client: FlaskClient, **body: Any) -> Any:
    return ok(client.post(f"{BASE}/queue", json={"kind": "question", **body}))


def web_book_order(chapters: list[dict[str, Any]]) -> list[str]:
    """The web app's bookOrder (web/app/lib/session.ts): chapter, section position, authored order."""
    keyed = []
    for c in chapters:
        pos = {s["id"]: i for i, s in enumerate(c["sections"])}
        keyed += [((c["number"], pos.get(q["section"], 0), i), q) for i, q in enumerate(c["questions"])]
    return [q["id"] for _, q in sorted(keyed, key=lambda x: x[0]) if not q.get("retired")]


def test_book_order_matches_the_web_app(client: FlaskClient) -> None:
    content = ok(client.get("/api/courses/tlpi/content"))
    expected = web_book_order(content["chapters"])
    body = ok(client.post("/api/courses/tlpi/queue", json={"kind": "question"}))
    assert body["fresh"] == expected[:20]  # 20 new/day
    everything = ok(client.post("/api/courses/tlpi/queue", json={"kind": "question", "candidates": expected}))
    assert everything["fresh"] == body["fresh"]


def test_learning_cards_and_learn_ahead(client: FlaskClient) -> None:
    rate(client, "r1", "demo-q001", "again")  # back in 1 minute
    assert queue(client, learnAhead=False)["learning"] == []
    assert queue(client, learnAhead=True)["learning"] == ["demo-q001"]  # within 20 minutes


def test_new_per_day_counts_todays_new_cards(client: FlaskClient, clock: Clock) -> None:
    # course.yaml: 5 new/day
    rate(client, "r1", "demo-q001", "good")
    rate(client, "r2", "demo-q002", "good")
    assert len(queue(client)["fresh"]) == 3
    clock.advance(minutes=DAY)  # a new study day
    assert len(queue(client)["fresh"]) == 5


def test_due_reviews_come_back(client: FlaskClient, clock: Clock) -> None:
    rate(client, "r1", "demo-q001", "easy")  # graduates straight to review in ~4 days
    assert queue(client)["review"] == []
    clock.advance(minutes=6 * DAY)
    body = queue(client)
    assert body["review"] == ["demo-q001"]
    assert "demo-q001" not in body["fresh"]


def test_candidates_set_the_order_and_must_be_active(client: FlaskClient) -> None:
    order = ["demo-q005", "demo-q004", "demo-q003", "demo-q002", "demo-q001", "demo-q006"]
    assert queue(client, candidates=order)["fresh"] == order[:5]
    assert queue(client, candidates=[])["fresh"] == []
    err = ok(client.post(f"{BASE}/queue", json={"kind": "question", "candidates": ["demo-ex01"]}), 400)
    assert err["error"]["code"] == "invalid_request"


def test_suspended_cards_never_appear(client: FlaskClient) -> None:
    ok(client.patch(f"{BASE}/cards/demo-q001", json={"suspended": True}))
    assert "demo-q001" not in queue(client, candidates=["demo-q001", "demo-q002"])["fresh"]


def test_today_for_the_course_home(client: FlaskClient, clock: Clock) -> None:
    body = ok(client.get(f"{BASE}/today"))
    assert (body["learning"], body["review"], len(body["fresh"]), body["redo"], body["nextDue"]) == (
        [],
        [],
        5,
        [],
        None,
    )
    rate(client, "r1", "demo-q001", "again")
    rate(client, "e1", "demo-ex01", "good")  # redo in 3 days
    body = ok(client.get(f"{BASE}/today"))
    assert body["learning"] == []  # no learn-ahead on the home screen
    assert body["nextDue"] == clock.ms + 60_000
    clock.advance(minutes=4 * DAY)
    body = ok(client.get(f"{BASE}/today"))
    assert (body["learning"], body["redo"]) == (["demo-q001"], ["demo-ex01"])


def test_course_grid_counts_are_per_course(client: FlaskClient) -> None:
    rate(client, "r1", "demo-q001", "good")
    courses = {c["slug"]: c["today"] for c in ok(client.get("/api/courses"))["courses"]}
    assert courses == {
        "demo": {"learning": 0, "review": 0, "fresh": 4},
        "tlpi": {"learning": 0, "review": 0, "fresh": 20},
    }
