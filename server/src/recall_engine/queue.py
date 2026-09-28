"""What is due, and Anki's queue for today with its daily limits."""

from collections.abc import Iterable, Mapping, Sequence

from .clock import StudyClock, day_start_ms, study_day
from .types import Card, CardKind, DoneToday, Phase, Preset, ReviewLog, TodayQueue

# Anki calls a card "mature" at a 21-day interval; Recall calls it mastered.
MATURE_DAYS = 21
MINUTE = 60_000


def is_due(card: Card | None, now: int) -> bool:
    return card is not None and not card.suspended and card.phase != Phase.NEW and card.due <= now


def is_mastered(card: Card | None) -> bool:
    return card is not None and card.phase == Phase.REVIEW and card.interval >= MATURE_DAYS


def done_today(reviews: Iterable[ReviewLog], now: int, clock: StudyClock) -> dict[CardKind, DoneToday]:
    """New cards introduced and reviews done so far this study day, per card kind."""
    start = day_start_ms(study_day(now, clock), clock)
    new_done = dict.fromkeys(CardKind, 0)
    reviews_done = dict.fromkeys(CardKind, 0)
    for r in reviews:
        if r.at < start:
            continue
        if r.phase_before == Phase.NEW:
            new_done[r.kind] += 1
        elif r.phase_before == Phase.REVIEW:
            reviews_done[r.kind] += 1
    return {k: DoneToday(new_done=new_done[k], reviews_done=reviews_done[k]) for k in CardKind}


def today_queue(
    candidates: Sequence[str],
    cards: Mapping[str, Card],
    now: int,
    preset: Preset,
    done: DoneToday,
    learn_ahead: bool = True,
) -> TodayQueue:
    """Anki's queue for one card kind. `candidates` are active item ids in study order.

    Learning cards due now (or within the learn-ahead window), then due reviews oldest first up to
    reviews/day, then unseen cards in candidate order up to new/day. Suspended cards never appear.
    """
    horizon = now + (preset.learn_ahead_minutes * MINUTE if learn_ahead else 0)
    learning: list[Card] = []
    review: list[Card] = []
    fresh: list[str] = []
    for card_id in candidates:
        card = cards.get(card_id)
        if card is None or card.phase == Phase.NEW:
            if card is None or not card.suspended:
                fresh.append(card_id)
        elif card.suspended:
            continue
        elif card.phase == Phase.REVIEW:
            if is_due(card, now):
                review.append(card)
        elif card.due <= horizon:
            learning.append(card)

    def by_due(c: Card) -> int:
        return c.due

    return TodayQueue(
        learning=tuple(c.id for c in sorted(learning, key=by_due)),
        review=tuple(
            c.id for c in sorted(review, key=by_due)[: max(0, preset.reviews_per_day - done.reviews_done)]
        ),
        fresh=tuple(fresh[: max(0, preset.new_per_day - done.new_done)]),
    )
