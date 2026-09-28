"""JavaScript number semantics the TS engine relied on."""

import math


def js_round(x: float) -> int:
    """Math.round: halves round toward +infinity (Python's round() rounds to even)."""
    floor = math.floor(x)
    return floor + 1 if x - floor >= 0.5 else floor


def js_num_str(x: float) -> str:
    """How JS prints a number in a template string: 1 not 1.0."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))
