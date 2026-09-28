"""Anki-style step strings: "1m 10m 1d". Stored as minutes."""

import re

from .jsmath import js_num_str, js_round

_UNIT = {"s": 1 / 60, "m": 1.0, "h": 60.0, "d": 24 * 60.0}
_STEP = re.compile(r"^(\d+(?:\.\d+)?)([smhd]?)$", re.IGNORECASE)


def parse_steps(text: str) -> tuple[float, ...] | None:
    """Parse "1m 10m 1d" (bare numbers are minutes). None when any part is invalid."""
    out: list[float] = []
    for part in (p for p in re.split(r"[\s,]+", text.strip()) if p):
        match = _STEP.match(part)
        if not match:
            return None
        minutes = float(match.group(1)) * _UNIT[(match.group(2) or "m").lower()]
        if not minutes > 0:
            return None
        out.append(minutes)
    return tuple(out)


def format_steps(steps: tuple[float, ...]) -> str:
    def one(m: float) -> str:
        if m % (24 * 60) == 0:
            return f"{js_num_str(m / (24 * 60))}d"
        if m % 60 == 0:
            return f"{js_num_str(m / 60)}h"
        if m < 1:
            return f"{js_round(m * 60)}s"
        return f"{js_num_str(m)}m"

    return " ".join(one(m) for m in steps)
