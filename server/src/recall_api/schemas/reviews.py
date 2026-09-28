"""Request bodies for rating events, sessions, card and exercise changes."""

from typing import Any, Literal

from pydantic import ConfigDict, Field

from .progress import Rating, Wire


class Strict(Wire):
    model_config = ConfigDict(extra="forbid")


class ReviewRequest(Strict):
    id: str = Field(min_length=1, max_length=200)  # client-generated; makes retries safe
    item_key: str = Field(min_length=1)
    source: Literal["quiz", "flashcard", "exercise"]
    session_id: str | None = None
    rating: Rating
    correct: bool
    answer: str = ""
    hinted: bool = False
    duration_ms: int | None = Field(default=None, ge=0)
    meta: dict[str, Any] | None = None


class SessionRequest(Strict):
    id: str = Field(min_length=1, max_length=200)
    mode: Literal["quiz", "flashcards", "exercise"]


class CardPatch(Strict):
    suspended: bool


class ExercisePatch(Strict):
    """Only the fields sent are changed."""

    status: Literal["not-started", "in-progress", "done", "skipped"] | None = None
    notes: str | None = Field(default=None, max_length=100_000)
    tests_passed: list[str] | None = None  # test names
    hints_revealed: int | None = Field(default=None, ge=0)


class AttemptRequest(Strict):
    mode: Literal["redo", "quick"]


class QueueRequest(Strict):
    kind: Literal["question", "exercise"]
    learn_ahead: bool = True
    # Item keys in the order to introduce new ones (after the client's filters and shuffle);
    # omitted = every active item of this kind in book order.
    candidates: list[str] | None = Field(default=None, max_length=10_000)
