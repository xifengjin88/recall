"""Real API responses saved for the web app's type check (web/app/api/contract.ts).

    GEN_SAMPLES=1 uv run pytest tests/api/test_samples.py   # rewrite after an API change
    uv run pytest                                          # fails if a sample is stale

tsc then fails if web/app/api/types.ts no longer matches what the server sends.
"""

import json
import os
from pathlib import Path
from typing import Any

import pytest
from flask.testing import FlaskClient

pytestmark = pytest.mark.usefixtures("courses")

SAMPLES = Path(__file__).resolve().parents[3] / "web" / "app" / "api" / "samples"

ENDPOINTS = {
    "courses": "/api/courses",
    "course": "/api/courses/demo",
    "content": "/api/courses/demo/content",
    "notes": "/api/courses/demo/units/1/notes",
    "error": "/api/courses/nope",
}


# Learning endpoints, called in this order in one transaction so each sees the ones before.
LEARNING: list[tuple[str, str, str, Any]] = [
    ("session", "post", "/api/courses/demo/sessions", {"id": "s1", "mode": "quiz"}),
    (
        "review",
        "post",
        "/api/courses/demo/reviews",
        {
            "id": "s1:0",
            "itemKey": "demo-q001",
            "source": "quiz",
            "sessionId": "s1",
            "rating": "again",
            "correct": False,
            "answer": "a",
            "durationMs": 3000,
        },
    ),
    ("preview", "get", "/api/courses/demo/cards/demo-q001/preview", None),
    ("progress", "get", "/api/courses/demo/progress", None),
    ("queue", "post", "/api/courses/demo/queue", {"kind": "question"}),
    ("today", "get", "/api/courses/demo/today", None),
    ("exercise", "patch", "/api/courses/demo/exercises/demo-ex01", {"testsPassed": ["prints hello"]}),
    (
        "scheduling",
        "patch",
        "/api/courses/demo/scheduling",
        {"kind": "question", "changes": {"learnSteps": [2, 20]}},
    ),
    ("settings", "patch", "/api/settings", {"timeZone": "America/New_York"}),
]


def check(name: str, body: Any) -> None:
    text = json.dumps(body, indent=1, ensure_ascii=False, sort_keys=True) + "\n"
    path = SAMPLES / f"{name}.json"
    if os.environ.get("GEN_SAMPLES"):
        SAMPLES.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    assert path.read_text() == text, (
        f"{path.name} is stale: GEN_SAMPLES=1 uv run pytest tests/api/test_samples.py"
    )


@pytest.mark.parametrize("name", ENDPOINTS)
def test_sample_is_current(client: FlaskClient, name: str) -> None:
    check(name, client.get(ENDPOINTS[name]).json)


def test_learning_samples_are_current(client: FlaskClient) -> None:
    for name, method, path, body in LEARNING:
        res = getattr(client, method)(path, json=body)
        assert res.status_code == 200, res.json
        check(name, res.json)
