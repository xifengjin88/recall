"""JS → Python traps the port must get right (SPEC-sm2-engine §Parity)."""

from typing import Any

import pytest

from recall_engine.jsmath import js_num_str, js_round
from recall_engine.rng import fnv1a, mulberry32


@pytest.mark.parametrize(
    ("x", "expected"),
    [(2.5, 3), (-2.5, -2), (1.5, 2), (0.5, 1), (-0.5, 0), (2.4999, 2), (0.49999999999999994, 0), (12.0, 12)],
)
def test_js_round_rounds_half_up_not_to_even(x: float, expected: int) -> None:
    assert js_round(x) == expected


def test_js_number_strings() -> None:
    assert [js_num_str(v) for v in (1.0, 1.5, 10, 0.25, 1440.0)] == ["1", "1.5", "10", "0.25", "1440"]


def test_fnv1a_matches_js_including_utf16_code_units(g: dict[str, Any]) -> None:
    for case in g["rng"]["hash"]:
        assert fnv1a(case["s"]) == case["h"], case["s"]


def test_mulberry32_matches_js_32bit_maths(g: dict[str, Any]) -> None:
    for case in g["rng"]["seq"]:
        rng = mulberry32(case["seed"])
        assert [rng() for _ in case["values"]] == case["values"], case["seed"]
