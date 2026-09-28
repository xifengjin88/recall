"""Learner-wide settings (theme, key hints, time zone, session prefs) and per-course scheduling options."""

import uuid
from dataclasses import asdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_engine import CardKind, resolve_preset

from ..errors import ApiError
from ..models import DEFAULT_LEARNER_ID, Course, Unit
from ..schemas.progress import PrefsOut
from ..schemas.settings import LearnerSettingsOut, SchedulingOut, SchedulingPatch, SettingsPatch
from .cards import camel
from .progress import course_settings, learner_settings, overrides_out


def settings_out(session: Session, learner_id: uuid.UUID = DEFAULT_LEARNER_ID) -> LearnerSettingsOut:
    row = learner_settings(session, learner_id)
    return LearnerSettingsOut(
        theme=row.theme,  # type: ignore[arg-type]
        show_key_hints=row.show_key_hints,
        time_zone=row.time_zone,
        prefs=PrefsOut.model_validate(row.prefs or {}),
    )


def update_settings(
    session: Session, patch: SettingsPatch, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> LearnerSettingsOut:
    row = learner_settings(session, learner_id)
    if patch.theme is not None:
        row.theme = patch.theme
    if patch.show_key_hints is not None:
        row.show_key_hints = patch.show_key_hints
    if patch.time_zone is not None:
        row.time_zone = patch.time_zone
    if patch.prefs is not None:
        row.prefs = patch.prefs.model_dump(mode="json")
    session.flush()
    return settings_out(session, learner_id)


def _preset_out(kind: CardKind, *layers: dict[str, Any]) -> dict[str, Any]:
    preset = resolve_preset(kind, *layers)
    return {camel(k): list(v) if isinstance(v, tuple) else v for k, v in asdict(preset).items()}  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]


def scheduling_out(
    session: Session, course: Course, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> SchedulingOut:
    overrides: dict[str, Any] = course_settings(session, course, learner_id).scheduling
    defaults: dict[str, Any] = {}
    effective: dict[str, Any] = {}
    for kind in CardKind:
        course_layer: dict[str, Any] = course.scheduling.get(kind.value, {})
        defaults[kind.value] = _preset_out(kind, course_layer)
        effective[kind.value] = _preset_out(kind, course_layer, overrides.get(kind.value, {}))
    return SchedulingOut(defaults=defaults, overrides=overrides_out(overrides), effective=effective)  # type: ignore[arg-type]


def update_scheduling(
    session: Session, course: Course, patch: SchedulingPatch, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> SchedulingOut:
    """Merge changes into this kind's overrides (a null option removes it); null changes reset the kind."""
    row = course_settings(session, course, learner_id)
    stored: dict[str, Any] = dict(row.scheduling)
    if patch.changes is None:
        stored.pop(patch.kind, None)
    else:
        kind_opts: dict[str, Any] = dict(stored.get(patch.kind, {}))
        for name in patch.changes.model_fields_set:
            value = getattr(patch.changes, name)
            if value is None:
                kind_opts.pop(name, None)
            else:
                kind_opts[name] = value
        # Checked against the combined options, like the engine will see them.
        course_layer: dict[str, Any] = course.scheduling.get(patch.kind, {})
        merged = resolve_preset(CardKind(patch.kind), course_layer, kind_opts)
        if merged.min_interval > merged.max_interval:
            raise ApiError(400, "invalid_request", "The minimum interval can't exceed the maximum interval.")
        if kind_opts:
            stored[patch.kind] = kind_opts
        else:
            stored.pop(patch.kind, None)
    row.scheduling = stored  # a new dict, so SQLAlchemy sees the change
    session.flush()
    return scheduling_out(session, course, learner_id)


def set_last_unit(
    session: Session, course: Course, number: int, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> None:
    if session.scalar(select(Unit.id).where(Unit.course_id == course.id, Unit.number == number)) is None:
        raise ApiError(404, "unit_not_found", f"{course.short} has no unit {number}.")
    course_settings(session, course, learner_id).last_unit = number
    session.flush()
