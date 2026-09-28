"""Tables (SPEC-store.md). No behaviour beyond relationships; services hold the logic."""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

DEFAULT_LEARNER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class Base(DeclarativeBase):
    # All instants are timestamptz (UTC); see timeconv.py.
    type_annotation_map = {dict[str, Any]: JSONB, list[str]: ARRAY(Text), datetime: DateTime(timezone=True)}


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


# ---- content (migration 0001) -------------------------------------------------------


class Learner(Timestamps, Base):
    __tablename__ = "learners"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]


class Course(Timestamps, Base):
    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(unique=True)
    title: Mapped[str]
    short: Mapped[str]
    author: Mapped[str | None]
    description: Mapped[str | None]
    scheduling: Mapped[dict[str, Any]] = mapped_column(default=dict)
    content_hash: Mapped[str]

    units: Mapped[list["Unit"]] = relationship(
        back_populates="course", order_by="Unit.number", cascade="all, delete-orphan"
    )


class Unit(Timestamps, Base):
    __tablename__ = "units"
    __table_args__ = (UniqueConstraint("course_id", "number"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    number: Mapped[int]
    title: Mapped[str]
    note_title: Mapped[str | None]
    folder: Mapped[str | None]
    position: Mapped[int]
    has_content: Mapped[bool] = mapped_column(default=False)

    course: Mapped[Course] = relationship(back_populates="units")
    sections: Mapped[list["Section"]] = relationship(
        back_populates="unit", order_by="Section.position", cascade="all, delete-orphan"
    )
    notes: Mapped["Notes | None"] = relationship(back_populates="unit", cascade="all, delete-orphan")


class Section(Timestamps, Base):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("unit_id", "key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"))
    key: Mapped[str]
    title: Mapped[str]
    position: Mapped[int]

    unit: Mapped[Unit] = relationship(back_populates="sections")


class Notes(Timestamps, Base):
    __tablename__ = "notes"

    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), primary_key=True)
    markdown: Mapped[str]
    content_hash: Mapped[str]

    unit: Mapped[Unit] = relationship(back_populates="notes")


class Item(Timestamps, Base):
    """A question or exercise. `body` is the validated item as the API serves it (camelCase, id = key)."""

    __tablename__ = "items"
    __table_args__ = (
        UniqueConstraint("course_id", "key"),
        Index("ix_items_unit_position", "unit_id", "position"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"))
    key: Mapped[str]
    kind: Mapped[str]  # "question" | "exercise"
    type: Mapped[str | None]  # question type; None for exercises
    section_keys: Mapped[list[str]]
    difficulty: Mapped[int] = mapped_column(SmallInteger)
    tags: Mapped[list[str]]
    body: Mapped[dict[str, Any]]
    retired: Mapped[bool] = mapped_column(default=False)
    position: Mapped[int]
    content_hash: Mapped[str]


class ImportRun(Base):
    __tablename__ = "import_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    at: Mapped[datetime] = mapped_column(server_default=func.now())
    content_hash: Mapped[str]
    summary: Mapped[dict[str, Any]]
    dry_run: Mapped[bool] = mapped_column(default=False)


# ---- progress (migration 0002). Every row belongs to one learner and one course. -------------

PHASES = "'new', 'learning', 'review', 'relearning'"
RATINGS = "'again', 'hard', 'good', 'easy'"
KINDS = "'question', 'exercise'"


class CardRow(Base):
    """Scheduling state of one item for one learner (recall_engine.Card). `updated_at` comes from the engine."""

    __tablename__ = "cards"
    __table_args__ = (
        Index("ix_cards_learner_course_due", "learner_id", "course_id", "due"),
        CheckConstraint(f"phase IN ({PHASES})", name="ck_cards_phase"),
        CheckConstraint(f"last_rating IS NULL OR last_rating IN ({RATINGS})", name="ck_cards_last_rating"),
        CheckConstraint(f"kind IN ({KINDS})", name="ck_cards_kind"),
    )

    learner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), primary_key=True)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    kind: Mapped[str]
    phase: Mapped[str]
    step: Mapped[int]
    due: Mapped[datetime]
    interval_days: Mapped[int]
    ease: Mapped[float]
    reps: Mapped[int]
    lapses: Mapped[int]
    last_review: Mapped[datetime | None]
    last_rating: Mapped[str | None]
    leech: Mapped[bool]
    suspended: Mapped[bool]
    updated_at: Mapped[datetime]


class ReviewRow(Base):
    """One rating of one card. `before`/`after` are full engine cards (camelCase JSON)."""

    __tablename__ = "reviews"
    __table_args__ = (
        Index("ix_reviews_learner_course_at", "learner_id", "course_id", "at"),
        Index("ix_reviews_learner_item", "learner_id", "item_id"),
        CheckConstraint(f"rating IN ({RATINGS})", name="ck_reviews_rating"),
        CheckConstraint("source IN ('quiz', 'flashcard', 'exercise')", name="ck_reviews_source"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)  # client-generated, makes retries idempotent
    learner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learners.id", ondelete="CASCADE"))
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"))
    kind: Mapped[str]
    source: Mapped[str]
    session_id: Mapped[str | None]
    at: Mapped[datetime]
    rating: Mapped[str]
    correct: Mapped[bool]
    answer: Mapped[str]
    hinted: Mapped[bool]
    overridden: Mapped[bool]
    before: Mapped[dict[str, Any]]
    after: Mapped[dict[str, Any]]
    duration_ms: Mapped[int | None]
    meta: Mapped[dict[str, Any] | None]


class SessionRow(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        Index("ix_sessions_learner_course_day", "learner_id", "course_id", "completed_day"),
        CheckConstraint("mode IN ('quiz', 'flashcards', 'exercise')", name="ck_sessions_mode"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    learner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("learners.id", ondelete="CASCADE"))
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    mode: Mapped[str]
    started_at: Mapped[datetime]
    completed_at: Mapped[datetime | None]
    completed_day: Mapped[date | None]


class ExerciseStateRow(Base):
    __tablename__ = "exercise_states"
    __table_args__ = (
        CheckConstraint(
            "status IN ('not-started', 'in-progress', 'done', 'skipped')", name="ck_exercise_status"
        ),
        CheckConstraint("attempt IN ('first', 'redo', 'quick')", name="ck_exercise_attempt"),
    )

    learner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), primary_key=True)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    status: Mapped[str]
    notes: Mapped[str]
    attempt: Mapped[str]
    attempt_started_at: Mapped[datetime | None]
    tests_passed: Mapped[list[str]]
    hints_revealed: Mapped[int]
    updated_at: Mapped[datetime]


class LearnerSettings(Base):
    __tablename__ = "learner_settings"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    theme: Mapped[str] = mapped_column(default="system")
    show_key_hints: Mapped[bool] = mapped_column(default=True)
    time_zone: Mapped[str] = mapped_column(default="UTC")
    prefs: Mapped[dict[str, Any]] = mapped_column(default=dict)


class CourseSettings(Base):
    """Per learner and course: scheduling overrides (Preset field names per kind) and the last unit visited."""

    __tablename__ = "course_settings"

    learner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("learners.id", ondelete="CASCADE"), primary_key=True
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("courses.id", ondelete="CASCADE"), primary_key=True
    )
    scheduling: Mapped[dict[str, Any]] = mapped_column(default=dict)
    last_unit: Mapped[int | None]
