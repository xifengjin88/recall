"""Real API responses saved for the web app's type check (web/app/api/contract.ts).

    GEN_SAMPLES=1 uv run pytest tests/api/test_samples.py   # rewrite after an API change
    uv run pytest                                          # fails if a sample is stale

tsc then fails if web/app/api/types.ts no longer matches what the server sends.
"""

import json
import os
from pathlib import Path

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


@pytest.mark.parametrize("name", ENDPOINTS)
def test_sample_is_current(client: FlaskClient, name: str) -> None:
    body = client.get(ENDPOINTS[name]).json
    text = json.dumps(body, indent=1, ensure_ascii=False, sort_keys=True) + "\n"
    path = SAMPLES / f"{name}.json"
    if os.environ.get("GEN_SAMPLES"):
        SAMPLES.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    assert path.read_text() == text, (
        f"{path.name} is stale: GEN_SAMPLES=1 uv run pytest tests/api/test_samples.py"
    )
