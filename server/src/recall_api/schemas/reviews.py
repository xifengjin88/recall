"""Request bodies for rating events, sessions and card changes."""

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
