"""Tables (SPEC-store.md). No behaviour beyond relationships; services hold the logic."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ARRAY, DateTime, ForeignKey, Index, SmallInteger, Text, UniqueConstraint, func
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
