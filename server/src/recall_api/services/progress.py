"""A learner's progress in one course: load, import (v2 or the old v1 box format), export, reset."""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from recall_engine import StudyClock, day_start_ms

from ..errors import ApiError
from ..models import (
    DEFAULT_LEARNER_ID,
    CardRow,
    Course,
    CourseSettings,
    ExerciseStateRow,
    Item,
    LearnerSettings,
    ReviewRow,
    SessionRow,
    Unit,
)
from ..schemas.progress import (
    CardOut,
    ExerciseStateOut,
    PrefsOut,
    ProgressData,
    ReviewOut,
    SessionOut,
    SettingsOut,
)
from ..timeconv import to_dt, to_dt_opt, to_ms, to_ms_opt
from .cards import camel, card_from_out, card_out, card_to_row_values, row_to_card, snake

EXPORT_APP = "recall"
LEGACY_EXPORT_APPS = ("tlpi-drill",)


# ---- exercise state rows -----------------------------------------------------------


def exercise_row(session: Session, item: Item, learner_id: uuid.UUID, now: int) -> ExerciseStateRow:
    """The learner's state for an exercise, created as not started if there is none yet."""
    row = session.get(ExerciseStateRow, (learner_id, item.id))
    if row is None:
        row = ExerciseStateRow(
            learner_id=learner_id,
            item_id=item.id,
            course_id=item.course_id,
            status="not-started",
            notes="",
            attempt="first",
            attempt_started_at=None,
            tests_passed=[],
            hints_revealed=0,
            updated_at=to_dt(now),
        )
        session.add(row)
    return row


def exercise_out(row: ExerciseStateRow) -> ExerciseStateOut:
    return ExerciseStateOut(
        status=row.status,  # type: ignore[arg-type]
        notes=row.notes,
        attempt=row.attempt,  # type: ignore[arg-type]
        attempt_started_at=to_ms_opt(row.attempt_started_at),
        tests_passed=list(row.tests_passed),
        hints_revealed=row.hints_revealed,
        updated_at=to_ms(row.updated_at),
    )


# ---- settings rows -----------------------------------------------------------------


def learner_settings(session: Session, learner_id: uuid.UUID = DEFAULT_LEARNER_ID) -> LearnerSettings:
    row = session.get(LearnerSettings, learner_id)
    if row is None:
        row = LearnerSettings(
            learner_id=learner_id, theme="system", show_key_hints=True, time_zone="UTC", prefs={}
        )
        session.add(row)
        session.flush()
    return row


def course_settings(
    session: Session, course: Course, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> CourseSettings:
    row = session.get(CourseSettings, (learner_id, course.id))
    if row is None:
        row = CourseSettings(learner_id=learner_id, course_id=course.id, scheduling={}, last_unit=None)
        session.add(row)
        session.flush()
    return row


def learner_clock(session: Session, learner_id: uuid.UUID = DEFAULT_LEARNER_ID) -> StudyClock:
    return StudyClock(tz=learner_settings(session, learner_id).time_zone)


def overrides_out(stored: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Stored snake_case Preset overrides → the web app's camelCase ones."""
    return {kind: {camel(k): v for k, v in opts.items()} for kind, opts in stored.items()}


def overrides_in(wire: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {kind: {snake(k): v for k, v in opts.items()} for kind, opts in wire.items()}


# ---- load --------------------------------------------------------------------------


def load_progress(
    session: Session, course: Course, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> ProgressData:
    keys = dict(session.execute(select(Item.id, Item.key).where(Item.course_id == course.id)).all())
    cards: dict[str, CardOut] = {}
    for row in session.scalars(
        select(CardRow).where(CardRow.learner_id == learner_id, CardRow.course_id == course.id)
    ):
        key = keys[row.item_id]
        cards[key] = card_out(row_to_card(row, key))
    reviews = [
        ReviewOut(
            id=r.id,
            card_id=keys[r.item_id],
            kind=r.kind,  # type: ignore[arg-type]
            source=r.source,  # type: ignore[arg-type]
            session_id=r.session_id,
            at=to_ms(r.at),
            rating=r.rating,  # type: ignore[arg-type]
            correct=r.correct,
            answer=r.answer,
            hinted=r.hinted,
            overridden=r.overridden,
            before=r.before,
            after=r.after,
            duration_ms=r.duration_ms,
            meta=r.meta,
        )
        for r in session.scalars(
            select(ReviewRow)
            .where(ReviewRow.learner_id == learner_id, ReviewRow.course_id == course.id)
            .order_by(ReviewRow.at, ReviewRow.id)
        )
    ]
    sessions = [
        SessionOut(
            id=s.id,
            mode=s.mode,  # type: ignore[arg-type]
            started_at=to_ms(s.started_at),
            completed_at=to_ms_opt(s.completed_at),
            completed_day=s.completed_day.isoformat() if s.completed_day else None,
        )
        for s in session.scalars(
            select(SessionRow)
            .where(SessionRow.learner_id == learner_id, SessionRow.course_id == course.id)
            .order_by(SessionRow.started_at, SessionRow.id)
        )
    ]
    exercises = {
        keys[e.item_id]: exercise_out(e)
        for e in session.scalars(
            select(ExerciseStateRow).where(
                ExerciseStateRow.learner_id == learner_id, ExerciseStateRow.course_id == course.id
            )
        )
    }
    ls = learner_settings(session, learner_id)
    cs = course_settings(session, course, learner_id)
    return ProgressData(
        cards=cards,
        reviews=reviews,
        sessions=sessions,
        exercises=exercises,
        settings=SettingsOut(
            theme=ls.theme,  # type: ignore[arg-type]
            show_key_hints=ls.show_key_hints,
            scheduling=overrides_out(cs.scheduling),  # type: ignore[arg-type]
            time_zone=ls.time_zone,
        ),
        prefs=PrefsOut.model_validate(ls.prefs or {}),
        last_chapter=cs.last_unit,
    )


# ---- parsing import files ----------------------------------------------------------

V1_INTERVALS = (0, 1, 3, 7, 16, 35)


def _v1_snapshot(box: int) -> dict[str, Any]:
    interval = V1_INTERVALS[box] if 0 <= box < len(V1_INTERVALS) else 0
    return {"phase": "review" if box else "new", "interval": interval, "ease": 2.5, "due": 0}


def migrate_v1(v1: dict[str, Any], clock: StudyClock) -> ProgressData:
    """Port of migrateV1 (web/app/lib/progress.ts): boxes → review cards, attempts → reviews."""
    items: dict[str, Any] = v1.get("items") if isinstance(v1.get("items"), dict) else {}  # type: ignore[assignment]
    attempts: list[dict[str, Any]] = v1.get("attempts") if isinstance(v1.get("attempts"), list) else []  # type: ignore[assignment]
    cards: dict[str, CardOut] = {}
    for key, it in items.items():
        if not it or not it.get("box"):
            continue
        box = int(it["box"])
        cards[key] = CardOut(
            id=key,
            kind="question",
            phase="review",
            step=0,
            due=day_start_ms(date.fromisoformat(it["due"]), clock) if it.get("due") else 0,
            interval=V1_INTERVALS[box] if box < len(V1_INTERVALS) else 1,
            ease=2.5,
            reps=sum(1 for a in attempts if a.get("questionId") == key),
            lapses=0,
            last_review=it.get("updatedAt") or None,
            last_rating="again" if it.get("mistake") else "good",
            leech=False,
            suspended=False,
            updated_at=it.get("updatedAt") or 0,
        )
    reviews = []
    for a in attempts:
        rating = a.get("rating") or (
            "again" if not a["correct"] else "hard" if a.get("hinted") or a.get("overridden") else "good"
        )
        reviews.append(
            ReviewOut(
                id=a["id"],
                card_id=a["questionId"],
                kind="question",
                source="flashcard" if a.get("mode") == "flashcards" else "quiz",
                session_id=a.get("sessionId"),
                at=a["at"],
                rating=rating,
                correct=a["correct"],
                answer=a.get("answer", ""),
                hinted=a.get("hinted", False),
                overridden=a.get("overridden", False),
                before=_v1_snapshot(int(a.get("boxBefore", 0))),
                after=_v1_snapshot(int(a.get("boxAfter", 0))),
            )
        )
    exercises = {
        key: ExerciseStateOut(
            status=e["status"],
            notes=e.get("notes", ""),
            tests_passed=e.get("testsPassed", []),
            hints_revealed=e.get("hintsRevealed", 0),
            updated_at=e.get("updatedAt", 0),
        )
        for key, e in (v1.get("exercises") or {}).items()
    }
    raw_settings = v1.get("settings")
    settings: dict[str, Any] = raw_settings if isinstance(raw_settings, dict) else {}  # pyright: ignore[reportUnknownVariableType]
    return ProgressData(
        cards=cards,
        reviews=reviews,
        sessions=[SessionOut.model_validate(s) for s in v1.get("sessions") or []],
        exercises=exercises,
        settings=SettingsOut(
            theme=settings.get("theme", "system"), show_key_hints=settings.get("showKeyHints") is not False
        ),
        prefs=PrefsOut.model_validate(v1.get("prefs") or {}),
        last_chapter=v1.get("lastChapter") if isinstance(v1.get("lastChapter"), int) else None,
    )


def parse_file(raw: dict[str, Any], clock: StudyClock) -> ProgressData:
    """An export file ({app, data}) or bare progress data, version 2 or 1."""
    data = (
        raw.get("data")
        if isinstance(raw.get("data"), dict) and raw.get("app") in (EXPORT_APP, *LEGACY_EXPORT_APPS)
        else raw
    )
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_progress_file", "That isn't a Recall progress file.")
    if data.get("version") == 1:
        return migrate_v1(data, clock)
    if data.get("version") != 2:
        raise ApiError(400, "invalid_progress_file", "That isn't a Recall progress file (unknown version).")
    return ProgressData.model_validate(data)


# ---- merge (port of mergeProgress) -------------------------------------------------


def merge(current: ProgressData, incoming: ProgressData) -> ProgressData:
    """Keep the most recent record per item; union history (spec §7)."""
    cards = dict(current.cards)
    for key, card in incoming.cards.items():
        if key not in cards or card.updated_at > cards[key].updated_at:
            cards[key] = card
    exercises = dict(current.exercises)
    for key, ex in incoming.exercises.items():
        if key not in exercises or ex.updated_at > exercises[key].updated_at:
            exercises[key] = ex
    reviews = {r.id: r for r in current.reviews}
    for r in incoming.reviews:
        reviews.setdefault(r.id, r)
    sessions = {s.id: s for s in current.sessions}
    for s in incoming.sessions:
        if s.id not in sessions or (not sessions[s.id].completed_at and s.completed_at):
            sessions[s.id] = s
    return current.model_copy(
        update={
            "cards": cards,
            "exercises": exercises,
            "reviews": sorted(reviews.values(), key=lambda r: r.at),
            "sessions": sorted(sessions.values(), key=lambda s: s.started_at),
        }
    )


# ---- writing -----------------------------------------------------------------------


def _clear(
    session: Session, course: Course, learner_id: uuid.UUID, item_ids: set[uuid.UUID] | None = None
) -> None:
    for model in (CardRow, ReviewRow, ExerciseStateRow):
        stmt = delete(model).where(model.learner_id == learner_id, model.course_id == course.id)
        if item_ids is not None:
            stmt = stmt.where(model.item_id.in_(item_ids))
        session.execute(stmt)
    if item_ids is None:
        session.execute(
            delete(SessionRow).where(SessionRow.learner_id == learner_id, SessionRow.course_id == course.id)
        )


def _write(session: Session, course: Course, data: ProgressData, learner_id: uuid.UUID) -> int:
    """Insert all progress rows for this course. Returns how many records were skipped (unknown keys)."""
    items = {i.key: i for i in session.scalars(select(Item).where(Item.course_id == course.id))}
    skipped = 0
    for key, c in data.cards.items():
        item = items.get(key)
        if item is None:
            skipped += 1
            continue
        session.add(
            CardRow(
                learner_id=learner_id,
                item_id=item.id,
                course_id=course.id,
                **card_to_row_values(card_from_out(c)),
            )
        )
    for r in data.reviews:
        item = items.get(r.card_id)
        if item is None:
            skipped += 1
            continue
        session.add(
            ReviewRow(
                id=r.id,
                learner_id=learner_id,
                course_id=course.id,
                item_id=item.id,
                kind=r.kind,
                source=r.source,
                session_id=r.session_id,
                at=to_dt(r.at),
                rating=r.rating,
                correct=r.correct,
                answer=r.answer,
                hinted=r.hinted,
                overridden=r.overridden,
                before=r.before,
                after=r.after,
                duration_ms=r.duration_ms,
                meta=r.meta,
            )  # fmt: skip
        )
    for s in data.sessions:
        session.add(
            SessionRow(
                id=s.id,
                learner_id=learner_id,
                course_id=course.id,
                mode=s.mode,
                started_at=to_dt(s.started_at),
                completed_at=to_dt_opt(s.completed_at),
                completed_day=date.fromisoformat(s.completed_day) if s.completed_day else None,
            )  # fmt: skip
        )
    for key, e in data.exercises.items():
        item = items.get(key)
        if item is None:
            skipped += 1
            continue
        session.add(
            ExerciseStateRow(
                learner_id=learner_id,
                item_id=item.id,
                course_id=course.id,
                status=e.status,
                notes=e.notes,
                attempt=e.attempt,
                attempt_started_at=to_dt_opt(e.attempt_started_at),
                tests_passed=list(e.tests_passed),
                hints_revealed=e.hints_revealed,
                updated_at=to_dt(e.updated_at),
            )  # fmt: skip
        )
    session.flush()
    return skipped


def import_progress(
    session: Session,
    course: Course,
    raw: dict[str, Any],
    mode: str,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> tuple[ProgressData, int]:
    incoming = parse_file(raw, learner_clock(session, learner_id))
    if mode == "merge":
        incoming = merge(load_progress(session, course, learner_id), incoming)
    else:
        ls = learner_settings(session, learner_id)
        ls.theme = incoming.settings.theme
        ls.show_key_hints = incoming.settings.show_key_hints
        ls.prefs = incoming.prefs.out()
        cs = course_settings(session, course, learner_id)
        cs.scheduling = overrides_in(incoming.settings.scheduling)  # type: ignore[arg-type]
        cs.last_unit = incoming.last_chapter
    _clear(session, course, learner_id)
    session.flush()
    skipped = _write(session, course, incoming, learner_id)
    return load_progress(session, course, learner_id), skipped


def export_progress(
    session: Session, course: Course, learner_id: uuid.UUID = DEFAULT_LEARNER_ID
) -> dict[str, Any]:
    return {
        "app": EXPORT_APP,
        "subject": course.slug,
        "version": 2,
        "exportedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "data": load_progress(session, course, learner_id).out(),
    }


def reset_progress(
    session: Session,
    course: Course,
    unit_number: int | None = None,
    learner_id: uuid.UUID = DEFAULT_LEARNER_ID,
) -> ProgressData:
    """Delete one unit's progress, or all of this course's (settings are kept)."""
    if unit_number is None:
        _clear(session, course, learner_id)
        course_settings(session, course, learner_id).last_unit = None
    else:
        unit = session.scalars(
            select(Unit).where(Unit.course_id == course.id, Unit.number == unit_number)
        ).one_or_none()
        if unit is None:
            raise ApiError(404, "unit_not_found", f"{course.short} has no unit {unit_number}.")
        item_ids = set(session.scalars(select(Item.id).where(Item.unit_id == unit.id)))
        _clear(session, course, learner_id, item_ids)
    session.flush()
    return load_progress(session, course, learner_id)
