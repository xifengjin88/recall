"""Progress on the wire: the web app's ProgressData v2 (web/app/lib/progress.ts), camelCase, times in epoch ms.

Incoming data ignores unknown fields (older or newer app versions); outgoing data is dumped by alias.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Phase = Literal["new", "learning", "review", "relearning"]
Rating = Literal["again", "hard", "good", "easy"]
Kind = Literal["question", "exercise"]


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    def out(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


class CardOut(Wire):
    id: str  # item key
    kind: Kind
    phase: Phase
    step: int
    due: int
    interval: int
    ease: float
    reps: int
    lapses: int
    last_review: int | None
    last_rating: Rating | None
    leech: bool
    suspended: bool
    updated_at: int


class ReviewOut(Wire):
    id: str
    card_id: str  # item key
    kind: Kind
    source: Literal["quiz", "flashcard", "exercise"]
    session_id: str | None = None
    at: int
    rating: Rating
    correct: bool
    answer: str = ""
    hinted: bool = False
    overridden: bool = False
    before: dict[str, Any] = Field(default_factory=dict[str, Any])
    after: dict[str, Any] = Field(default_factory=dict[str, Any])
    duration_ms: int | None = None
    meta: dict[str, Any] | None = None


class SessionOut(Wire):
    id: str
    mode: Literal["quiz", "flashcards", "exercise"]
    started_at: int
    completed_at: int | None = None
    completed_day: str | None = None  # study day, "YYYY-MM-DD"


class ExerciseStateOut(Wire):
    status: Literal["not-started", "in-progress", "done", "skipped"] = "not-started"
    notes: str = ""
    attempt: Literal["first", "redo", "quick"] = "first"
    attempt_started_at: int | None = None
    tests_passed: list[str] = Field(default_factory=list[str])
    hints_revealed: int = 0
    updated_at: int = 0


class SettingsOut(Wire):
    theme: Literal["system", "light", "dark"] = "system"
    show_key_hints: bool = True
    # Learner overrides for this course, per kind, with camelCase Preset names (as the web app uses).
    scheduling: dict[Kind, dict[str, Any]] = Field(default_factory=dict[Kind, dict[str, Any]])
    time_zone: str = "UTC"


class PrefsOut(Wire):
    length: Literal[10, 20, "all"] = 10
    order: Literal["shuffled", "book"] = "shuffled"
    types: list[str] = Field(default_factory=list[str])
    difficulty: Literal[0, 1, 2, 3] = 0


class ProgressData(Wire):
    version: Literal[2] = 2
    cards: dict[str, CardOut] = Field(default_factory=dict[str, CardOut])
    reviews: list[ReviewOut] = Field(default_factory=list[ReviewOut])
    sessions: list[SessionOut] = Field(default_factory=list[SessionOut])
    exercises: dict[str, ExerciseStateOut] = Field(default_factory=dict[str, ExerciseStateOut])
    settings: SettingsOut = Field(default_factory=SettingsOut)
    prefs: PrefsOut = Field(default_factory=PrefsOut)
    last_chapter: int | None = None


class ImportRequest(Wire):
    mode: Literal["replace", "merge"]
    # An export file ({app, data}) or bare progress data, v2 or the old v1 box format.
    file: dict[str, Any]
