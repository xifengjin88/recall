"""Rating events: the server runs SM-2 (SPEC-learning-api.md)."""

from dataclasses import replace
from typing import Any

import pytest
from flask.testing import FlaskClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from recall_api.models import ReviewRow
from recall_api.services.progress import course_settings, learner_settings
from recall_engine import (
    EXERCISE_PRESET,
    QUESTION_PRESET,
    CardKind,
    Rating,
    StudyClock,
    answer,
    new_card,
    preview,
)

from .conftest import Clock

pytestmark = pytest.mark.usefixtures("courses")
BASE = "/api/courses/demo"
UTC = StudyClock(tz="UTC")
# course.yaml for the demo course sets new_per_day: 5 for questions; nothing that changes answers.
DEMO_QUESTION = replace(QUESTION_PRESET, new_per_day=5)


def rate(client: FlaskClient, rid: str, key: str, rating: str, **extra: Any) -> dict[str, Any]:
    body = {
        "id": rid,
        "itemKey": key,
        "source": "quiz",
        "sessionId": "s1",
        "rating": rating,
        "correct": rating != "again",
        **extra,
    }
    res = client.post(f"{BASE}/reviews", json=body)
    assert res.status_code == 200, res.json
    assert res.json is not None
    return res.json


def engine_card(card: Any) -> dict[str, Any]:
    from recall_api.services.cards import card_out

    return card_out(card).out()


def test_first_answer_matches_the_engine(client: FlaskClient, clock: Clock) -> None:
    body = rate(client, "s1:0", "demo-q001", "good", answer="b", durationMs=4200)
    expected = answer(
        new_card("demo-q001", CardKind.QUESTION, DEMO_QUESTION), Rating.GOOD, clock.ms, DEMO_QUESTION, UTC
    )
    assert body["card"] == engine_card(expected)
    review = body["review"]
    assert (review["cardId"], review["rating"], review["at"], review["durationMs"]) == (
        "demo-q001",
        "good",
        clock.ms,
        4200,
    )
    assert review["before"]["phase"] == "new" and review["after"] == body["card"]


def test_repeated_review_id_is_a_no_op(client: FlaskClient, db: Session, clock: Clock) -> None:
    first = rate(client, "s1:0", "demo-q001", "again")
    clock.advance(minutes=5)
    second = rate(client, "s1:0", "demo-q001", "again")
    assert second == first
    assert db.scalar(select(func.count()).select_from(ReviewRow)) == 1


def test_learning_card_comes_back_in_minutes_then_graduates(client: FlaskClient, clock: Clock) -> None:
    wrong = rate(client, "s1:0", "demo-q001", "again")["card"]
    assert (wrong["phase"], wrong["due"]) == ("learning", clock.ms + 60_000)
    clock.advance(minutes=1)
    rate(client, "s1:1", "demo-q001", "good")
    clock.advance(minutes=10)
    graduated = rate(client, "s1:2", "demo-q001", "good")["card"]
    assert (graduated["phase"], graduated["interval"]) == ("review", 1)


def test_override_rerates_from_the_card_before(client: FlaskClient, clock: Clock) -> None:
    wrong = rate(client, "s1:0", "demo-q004", "again", answer="y")
    res = client.post(f"{BASE}/reviews/s1:0/override")
    assert res.status_code == 200 and res.json is not None
    before = new_card("demo-q004", CardKind.QUESTION, DEMO_QUESTION)
    assert res.json["card"] == engine_card(answer(before, Rating.HARD, clock.ms, DEMO_QUESTION, UTC))
    assert (
        res.json["review"]["rating"],
        res.json["review"]["correct"],
        res.json["review"]["overridden"],
    ) == ("hard", True, True)
    assert res.json["review"]["before"] == wrong["review"]["before"]
    again = client.post(f"{BASE}/reviews/s1:0/override").json
    assert again == res.json  # already overridden: unchanged


def test_preview_matches_the_engine(client: FlaskClient, clock: Clock) -> None:
    res = client.get(f"{BASE}/cards/demo-q002/preview").json
    card = new_card("demo-q002", CardKind.QUESTION, DEMO_QUESTION)
    expected = {r.value: engine_card(c) for r, c in preview(card, clock.ms, DEMO_QUESTION, UTC).items()}
    assert res == expected
    assert res is not None and res["again"]["due"] == clock.ms + 60_000


def test_learner_overrides_and_time_zone_are_used(client: FlaskClient, db: Session, clock: Clock) -> None:
    learner_settings(db).time_zone = "America/New_York"
    from recall_api.models import Course

    course = db.scalars(select(Course).where(Course.slug == "demo")).one()
    course_settings(db, course).scheduling = {"exercise": {"graduating_interval": 5}}
    db.flush()
    body = client.post(
        f"{BASE}/reviews",
        json={"id": "e:0", "itemKey": "demo-ex01", "source": "exercise", "rating": "good", "correct": True},
    ).json
    ny = StudyClock(tz="America/New_York")
    preset = replace(EXERCISE_PRESET, graduating_interval=5)
    expected = answer(new_card("demo-ex01", CardKind.EXERCISE, preset), Rating.GOOD, clock.ms, preset, ny)
    assert body is not None and body["card"] == engine_card(expected)
    assert body["card"]["interval"] == 5


def test_suspend(client: FlaskClient) -> None:
    res = client.patch(f"{BASE}/cards/demo-ex01", json={"suspended": True})
    assert res.status_code == 200 and res.json is not None
    assert (res.json["suspended"], res.json["phase"]) == (True, "new")
    assert client.get(f"{BASE}/progress").json["cards"]["demo-ex01"]["suspended"] is True  # type: ignore[index]


def test_sessions_start_idempotently_and_complete_on_the_study_day(
    client: FlaskClient, db: Session, clock: Clock
) -> None:
    learner_settings(db).time_zone = "America/Los_Angeles"
    db.flush()
    a = client.post(f"{BASE}/sessions", json={"id": "s9", "mode": "quiz"}).json
    b = client.post(f"{BASE}/sessions", json={"id": "s9", "mode": "quiz"}).json
    assert a == b and a is not None and "completedAt" not in a
    clock.ms = 1_790_593_140_000  # 2026-09-28 03:59 PDT: still the 27th's study day
    done = client.post(f"{BASE}/sessions/s9/complete").json
    assert done is not None and done["completedDay"] == "2026-09-27"


@pytest.mark.parametrize(
    ("method", "path", "json", "status", "code"),
    [
        (
            "post",
            "/reviews",
            {"id": "x", "itemKey": "nope", "source": "quiz", "rating": "good", "correct": True},
            404,
            "item_not_found",
        ),
        (
            "post",
            "/reviews",
            {"id": "x", "itemKey": "demo-q001", "source": "quiz", "rating": "great", "correct": True},
            400,
            "invalid_request",
        ),
        ("post", "/reviews/missing/override", None, 404, "review_not_found"),
        ("get", "/cards/nope/preview", None, 404, "item_not_found"),
        ("post", "/sessions/missing/complete", None, 404, "session_not_found"),
        ("post", "/sessions", {"id": "s", "mode": "cram"}, 400, "invalid_request"),
    ],
)
def test_errors(client: FlaskClient, method: str, path: str, json: Any, status: int, code: str) -> None:
    res = getattr(client, method)(f"{BASE}{path}", json=json)
    assert res.status_code == status, res.json
    assert res.json["error"]["code"] == code
