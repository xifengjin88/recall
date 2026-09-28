"""mulberry32 and FNV-1a with JavaScript's 32-bit integer semantics, so fuzz matches the TS engine."""

from collections.abc import Callable

_MASK = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """Math.imul on uint32 inputs; the low 32 bits are the same for signed and unsigned."""
    return (a * b) & _MASK


def mulberry32(seed: int) -> Callable[[], float]:
    state = seed & _MASK

    def next_float() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & _MASK
        t = _imul(state ^ (state >> 15), state | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & _MASK
        return ((t ^ (t >> 14)) & _MASK) / 4294967296

    return next_float


def fnv1a(s: str) -> int:
    """FNV-1a over UTF-16 code units (what JS charCodeAt iterates), not code points."""
    h = 0x811C9DC5
    data = s.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = _imul(h, 0x01000193)
    return h
