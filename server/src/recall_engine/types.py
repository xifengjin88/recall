"""Engine values. Frozen and slotted: every function returns new values, never mutates."""

from dataclasses import dataclass
from enum import StrEnum


class Rating(StrEnum):
    AGAIN = "again"
    HARD = "hard"
    GOOD = "good"
    EASY = "easy"


RATINGS: tuple[Rating, ...] = (Rating.AGAIN, Rating.HARD, Rating.GOOD, Rating.EASY)


class CardKind(StrEnum):
    QUESTION = "question"
    EXERCISE = "exercise"


class Phase(StrEnum):
    NEW = "new"
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"


@dataclass(frozen=True, slots=True)
class Card:
    """Scheduling state of one question or exercise. Times are UTC epoch milliseconds."""

    id: str
    kind: CardKind
    phase: Phase
    step: int  # index into the learning / relearning steps
    due: int  # learning: an exact moment; review: the start of the due study day
    interval: int  # days; for relearning cards, the interval they return to review with
    ease: float  # 2.5 = 250%
    reps: int
    lapses: int
    last_review: int | None
    last_rating: Rating | None
    leech: bool
    suspended: bool
    updated_at: int


@dataclass(frozen=True, slots=True)
class Preset:
    """Per-kind scheduling options (Anki's deck options). Steps are in minutes."""

    learn_steps: tuple[float, ...]
    relearn_steps: tuple[float, ...]
    graduating_interval: int
    easy_interval: int
    starting_ease: float
    hard_factor: float
    easy_bonus: float
    interval_modifier: float
    lapse_factor: float  # share of the interval kept after a lapse; 0 = back to min_interval
    min_interval: int
    max_interval: int
    min_ease: float
    fuzz: bool
    new_per_day: int
    reviews_per_day: int
    leech_lapses: int
    learn_ahead_minutes: int


@dataclass(frozen=True, slots=True)
class DoneToday:
    new_done: int = 0
    reviews_done: int = 0


@dataclass(frozen=True, slots=True)
class TodayQueue:
    learning: tuple[str, ...]  # due now (or within the learn-ahead window), earliest first
    review: tuple[str, ...]  # due reviews, oldest first, capped by reviews/day
    fresh: tuple[str, ...]  # unseen cards in the given order, capped by new/day


@dataclass(frozen=True, slots=True)
class ReviewLog:
    """The parts of a logged review the daily limits need."""

    at: int
    kind: CardKind
    phase_before: Phase
