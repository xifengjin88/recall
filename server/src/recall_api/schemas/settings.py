"""Learner settings and per-course scheduling options on the wire."""

from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from pydantic import Field, field_validator

from .progress import Kind, PrefsOut, Wire
from .reviews import Strict

# Steps are minutes: at least a second, at most a year; a dozen is plenty.
Step = Annotated[float, Field(gt=0, le=525_600)]
Steps = Annotated[list[Step], Field(max_length=12)]


class SchedulingChanges(Strict):
    """Scheduling options (Anki's deck options), camelCase, with the ranges the Settings form allows.

    Ratios are fractions (the form shows percentages). A null value removes that override.
    """

    learn_steps: Steps | None = None
    relearn_steps: Steps | None = None
    graduating_interval: Annotated[int, Field(ge=1, le=365)] | None = None
    easy_interval: Annotated[int, Field(ge=1, le=365)] | None = None
    starting_ease: Annotated[float, Field(ge=1.31, le=5)] | None = None
    hard_factor: Annotated[float, Field(ge=0.5, le=2)] | None = None
    easy_bonus: Annotated[float, Field(ge=1, le=5)] | None = None
    interval_modifier: Annotated[float, Field(ge=0.5, le=2)] | None = None
    lapse_factor: Annotated[float, Field(ge=0, le=1)] | None = None
    min_interval: Annotated[int, Field(ge=1, le=365)] | None = None
    max_interval: Annotated[int, Field(ge=1, le=36_500)] | None = None
    min_ease: Annotated[float, Field(ge=1, le=5)] | None = None
    fuzz: bool | None = None
    new_per_day: Annotated[int, Field(ge=0, le=9_999)] | None = None
    reviews_per_day: Annotated[int, Field(ge=0, le=99_999)] | None = None
    leech_lapses: Annotated[int, Field(ge=1, le=99)] | None = None
    learn_ahead_minutes: Annotated[int, Field(ge=0, le=1_440)] | None = None


class SchedulingPatch(Strict):
    kind: Kind
    changes: SchedulingChanges | None  # null resets this kind to the defaults


class SchedulingOut(Wire):
    """Per kind, camelCase Preset options: defaults (engine + course), the learner's overrides, the result."""

    defaults: dict[Kind, dict[str, Any]]
    overrides: dict[Kind, dict[str, Any]]
    effective: dict[Kind, dict[str, Any]]


class SettingsPatch(Strict):
    theme: Literal["system", "light", "dark"] | None = None
    show_key_hints: bool | None = None
    time_zone: str | None = None
    prefs: PrefsOut | None = None

    @field_validator("time_zone")
    @classmethod
    def _iana(cls, v: str | None) -> str | None:
        if v is None:
            return v
        # ZoneInfo also accepts file paths and legacy names; only real IANA keys are allowed.
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"unknown time zone {v!r}") from None
        if v not in available_timezones() and v != "UTC":
            raise ValueError(f"unknown time zone {v!r}")
        return v


class LearnerSettingsOut(Wire):
    theme: Literal["system", "light", "dark"]
    show_key_hints: bool
    time_zone: str
    prefs: PrefsOut


class LastUnit(Strict):
    number: Annotated[int, Field(ge=1)]
