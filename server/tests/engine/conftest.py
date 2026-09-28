"""Shared helpers: load the golden file written by web/scripts/gen-engine-golden.test.ts."""

import json
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from recall_engine import Card, CardKind, Phase, Preset, Rating, StudyClock

GOLDEN = Path(__file__).parent / "golden" / "sm2.json"


@cache
def golden() -> dict[str, Any]:
    return json.loads(GOLDEN.read_text())


@pytest.fixture
def g() -> dict[str, Any]:
    return golden()


@pytest.fixture
def clock() -> StudyClock:
    return StudyClock(tz=golden()["tz"])


def card_from(d: dict[str, Any]) -> Card:
    """TS Card (camelCase JSON) → engine Card."""
    return Card(
        id=d["id"],
        kind=CardKind(d["kind"]),
        phase=Phase(d["phase"]),
        step=d["step"],
        due=d["due"],
        interval=d["interval"],
        ease=d["ease"],
        reps=d["reps"],
        lapses=d["lapses"],
        last_review=d["lastReview"],
        last_rating=Rating(d["lastRating"]) if d["lastRating"] else None,
        leech=d["leech"],
        suspended=d["suspended"],
        updated_at=d["updatedAt"],
    )


def preset_from(d: dict[str, Any]) -> Preset:
    return Preset(
        learn_steps=tuple(d["learnSteps"]),
        relearn_steps=tuple(d["relearnSteps"]),
        graduating_interval=d["graduatingInterval"],
        easy_interval=d["easyInterval"],
        starting_ease=d["startingEase"],
        hard_factor=d["hardFactor"],
        easy_bonus=d["easyBonus"],
        interval_modifier=d["intervalModifier"],
        lapse_factor=d["lapseFactor"],
        min_interval=d["minInterval"],
        max_interval=d["maxInterval"],
        min_ease=d["minEase"],
        fuzz=d["fuzz"],
        new_per_day=d["newPerDay"],
        reviews_per_day=d["reviewsPerDay"],
        leech_lapses=d["leechLapses"],
        learn_ahead_minutes=d["learnAheadMinutes"],
    )
