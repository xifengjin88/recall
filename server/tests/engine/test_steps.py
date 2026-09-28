from typing import Any

from recall_engine import format_steps, parse_steps


def test_parse_steps_matches_ts(g: dict[str, Any]) -> None:
    for case in g["steps"]["parse"]:
        got = parse_steps(case["input"])
        assert (list(got) if got is not None else None) == case["output"], case["input"]


def test_format_steps_matches_ts(g: dict[str, Any]) -> None:
    for case in g["steps"]["format"]:
        assert format_steps(tuple(case["input"])) == case["output"], case["input"]
