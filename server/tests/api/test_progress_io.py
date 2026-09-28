"""Progress load / import / export / reset (SPEC-learning-api.md)."""

import json
from pathlib import Path
from typing import Any

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from recall_api.services.progress import learner_settings

pytestmark = pytest.mark.usefixtures("courses")

V1 = json.loads((Path(__file__).parent / "fixtures" / "v1-migration.json").read_text())
BASE = "/api/courses/demo"


def same(actual: Any, expected: Any, path: str = "") -> None:
    """Deep equality where a key missing from `expected` must be empty in `actual` (null, [], {}, false, 0)."""
    if isinstance(expected, dict):
        assert isinstance(actual, dict), path
        for key in set(actual) | set(expected):
            if key in expected:
                same(actual.get(key), expected[key], f"{path}.{key}")
            else:
                assert actual[key] in (None, [], {}, False, 0, ""), f"{path}.{key} = {actual[key]!r}"
    elif isinstance(expected, list):
        assert isinstance(actual, list) and len(actual) == len(expected), path
        for i, (a, e) in enumerate(zip(actual, expected, strict=True)):
            same(a, e, f"{path}[{i}]")
    else:
        assert actual == expected, f"{path}: {actual!r} != {expected!r}"


def test_empty_progress_has_defaults(client: FlaskClient) -> None:
    body = client.get(f"{BASE}/progress").json
    assert body is not None
    assert body["version"] == 2
    assert (body["cards"], body["reviews"], body["sessions"], body["exercises"]) == ({}, [], [], {})
    assert body["settings"] == {"theme": "system", "showKeyHints": True, "scheduling": {}, "timeZone": "UTC"}
    assert body["prefs"] == {"length": 10, "order": "shuffled", "types": [], "difficulty": 0}
    assert body["lastChapter"] is None


def import_v1(client: FlaskClient, db: Session) -> dict[str, Any]:
    learner_settings(db).time_zone = V1["tz"]  # the fixture's due dates are New York study days
    db.flush()
    res = client.put(f"{BASE}/progress", json={"mode": "replace", "file": V1["input"]})
    assert res.status_code == 200, res.json
    assert res.json is not None
    return res.json


def test_v1_file_converts_like_the_web_app(client: FlaskClient, db: Session) -> None:
    body = import_v1(client, db)
    assert body["skipped"] == 0
    got, want = body["progress"], V1["expected"]
    # The server returns history in time order; the TS conversion keeps file order.
    for part in ("reviews", "sessions"):
        got[part] = sorted(got[part], key=lambda r: r["id"])
        want[part] = sorted(want[part], key=lambda r: r["id"])
    for part in ("cards", "reviews", "sessions", "exercises", "prefs", "lastChapter"):
        same(got[part], want[part], part)
    assert (got["settings"]["theme"], got["settings"]["showKeyHints"]) == ("dark", False)


def test_export_reset_import_restores_identical_progress(client: FlaskClient, db: Session) -> None:
    import_v1(client, db)
    exported = client.get(f"{BASE}/progress/export").json
    assert exported is not None
    assert (exported["app"], exported["subject"], exported["version"]) == ("recall", "demo", 2)
    before = client.get(f"{BASE}/progress").json

    reset = client.delete(f"{BASE}/progress").json
    assert reset is not None and (reset["cards"], reset["reviews"], reset["sessions"]) == ({}, [], [])

    res = client.put(f"{BASE}/progress", json={"mode": "replace", "file": exported})
    assert res.status_code == 200
    assert client.get(f"{BASE}/progress").json == before


def test_merge_keeps_the_newer_record(client: FlaskClient, db: Session) -> None:
    import_v1(client, db)
    current = client.get(f"{BASE}/progress").json
    assert current is not None
    incoming = json.loads(json.dumps(current))
    newer = incoming["cards"]["demo-q001"] | {
        "interval": 99,
        "updatedAt": current["cards"]["demo-q001"]["updatedAt"] + 1,
    }
    older = incoming["cards"]["demo-q002"] | {"interval": 42, "updatedAt": 1}
    incoming["cards"].update({"demo-q001": newer, "demo-q002": older})
    incoming["reviews"].append(incoming["reviews"][0] | {"id": "new-review"})
    incoming["settings"]["theme"] = "light"

    body = client.put(f"{BASE}/progress", json={"mode": "merge", "file": incoming}).json
    assert body is not None
    merged = body["progress"]
    assert merged["cards"]["demo-q001"]["interval"] == 99
    assert merged["cards"]["demo-q002"]["interval"] == current["cards"]["demo-q002"]["interval"]
    assert [r["id"] for r in merged["reviews"]].count("new-review") == 1
    assert len(merged["reviews"]) == len(current["reviews"]) + 1
    assert merged["settings"]["theme"] == "dark"  # merge keeps current settings


def test_records_for_unknown_items_are_skipped(client: FlaskClient, db: Session) -> None:
    file = json.loads(json.dumps(V1["input"]))
    file["items"]["not-in-this-course"] = {"box": 2, "due": "2026-10-01", "mistake": False, "updatedAt": 5}
    learner_settings(db).time_zone = V1["tz"]
    db.flush()
    body = client.put(f"{BASE}/progress", json={"mode": "replace", "file": file}).json
    assert body is not None
    assert body["skipped"] == 1
    assert "not-in-this-course" not in body["progress"]["cards"]


def test_reset_one_unit(client: FlaskClient, db: Session) -> None:
    import_v1(client, db)
    body = client.delete(f"{BASE}/progress?unit=1").json
    assert body is not None
    assert body["cards"] == {} and body["reviews"] == [] and body["exercises"] == {}
    assert len(body["sessions"]) == 2  # sessions aren't tied to a unit
    missing = client.delete(f"{BASE}/progress?unit=7")
    assert missing.status_code == 404 and missing.json is not None
    assert missing.json["error"]["code"] == "unit_not_found"


def test_invalid_import_requests(client: FlaskClient) -> None:
    res = client.put(f"{BASE}/progress", json={"mode": "overwrite", "file": {}})
    assert res.status_code == 400 and res.json is not None
    assert res.json["error"]["code"] == "invalid_request"
    assert res.json["error"]["details"][0]["field"] == "mode"
    bad_file = client.put(f"{BASE}/progress", json={"mode": "merge", "file": {"hello": 1}})
    assert bad_file.status_code == 400 and bad_file.json is not None
    assert bad_file.json["error"]["code"] == "invalid_progress_file"
