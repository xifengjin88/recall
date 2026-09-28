"""Default presets (Anki's classic defaults) and layering of course and learner overrides."""

from collections.abc import Mapping
from dataclasses import fields, replace
from typing import Any, cast

from .types import CardKind, Preset

QUESTION_PRESET = Preset(
    learn_steps=(1, 10),
    relearn_steps=(10,),
    graduating_interval=1,
    easy_interval=4,
    starting_ease=2.5,
    hard_factor=1.2,
    easy_bonus=1.3,
    interval_modifier=1,
    lapse_factor=0,
    min_interval=1,
    max_interval=36500,
    min_ease=1.3,
    fuzz=True,
    new_per_day=20,
    reviews_per_day=200,
    leech_lapses=8,
    learn_ahead_minutes=20,
)

# Exercises take about an hour: no minute steps, lapses halve the interval, few per day.
EXERCISE_PRESET = replace(
    QUESTION_PRESET,
    learn_steps=(),
    relearn_steps=(),
    graduating_interval=3,
    easy_interval=7,
    lapse_factor=0.5,
    max_interval=365,
    new_per_day=1,
    reviews_per_day=2,
    learn_ahead_minutes=0,
)

PRESETS: Mapping[CardKind, Preset] = {CardKind.QUESTION: QUESTION_PRESET, CardKind.EXERCISE: EXERCISE_PRESET}

_FIELDS = frozenset(f.name for f in fields(Preset))


def resolve_preset(kind: CardKind, *layers: Mapping[str, object]) -> Preset:
    """Engine defaults for `kind`, then each override layer in order (course defaults, learner overrides).

    Layers use Preset field names; unknown names raise ValueError. Steps may be given as lists.
    """
    preset = PRESETS[kind]
    for layer in layers:
        unknown = set(layer) - _FIELDS
        if unknown:
            raise ValueError(f"unknown scheduling option(s): {', '.join(sorted(unknown))}")
        values: dict[str, Any] = dict(layer)
        for key in ("learn_steps", "relearn_steps"):
            if key in values:
                values[key] = tuple(cast("list[float]", values[key]))
        preset = replace(preset, **values)
    return preset
