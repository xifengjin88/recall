"""Anki's classic (SM-2 derived) scheduler.

A line-by-line port of web/app/lib/engine/sm2.ts; helper names match so the two can be read side by
side. Parity is enforced by tests/engine/test_golden.py.
Reference: https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html and Anki's v2 scheduler
for the late-review bonus and fuzz ranges.
"""

import math
from collections.abc import Callable
from dataclasses import replace

from .clock import StudyClock, add_days, day_start_ms, days_between, study_day
from .jsmath import js_round
from .rng import fnv1a, mulberry32
from .types import RATINGS, Card, CardKind, Phase, Preset, Rating

MINUTE = 60_000


def new_card(card_id: str, kind: CardKind, preset: Preset) -> Card:
    return Card(
        id=card_id,
        kind=kind,
        phase=Phase.NEW,
        step=0,
        due=0,
        interval=0,
        ease=preset.starting_ease,
        reps=0,
        lapses=0,
        last_review=None,
        last_rating=None,
        leech=False,
        suspended=False,
        updated_at=0,
    )


def _ms(x: float) -> int:
    """Learning-step due times: whole milliseconds (the TS engine never produced fractions in practice)."""
    return int(x) if float(x).is_integer() else js_round(x)


def _review_due(now: int, days: int, clock: StudyClock) -> int:
    """Start of the study day `days` after the one `now` falls in, as a UTC instant."""
    return day_start_ms(add_days(study_day(now, clock), days), clock)


def _hard_delay(steps: tuple[float, ...], step: int) -> float:
    """Hard repeats the current step; on the first step it waits the average of the first two."""
    if step > 0:
        return steps[step]
    first, *rest = steps  # callers only get here with at least one step
    if rest:
        return (first + rest[0]) / 2
    return min(first * 1.5, first + 24 * 60)


def _fuzz(interval: int, rng: Callable[[], float]) -> int:
    """Anki v2 fuzz ranges: cards learned together don't all fall due together."""
    if interval < 2:
        return interval
    if interval == 2:
        return 2 + math.floor(rng() * 2)
    if interval < 7:
        spread = math.floor(interval * 0.25)
    elif interval < 30:
        spread = max(2, math.floor(interval * 0.15))
    else:
        spread = max(4, math.floor(interval * 0.05))
    spread = max(1, spread)
    return interval - spread + math.floor(rng() * (2 * spread + 1))


def _constrain(raw: float, at_least: int, p: Preset, rng: Callable[[], float]) -> int:
    interval = js_round(raw * p.interval_modifier)
    if p.fuzz:
        interval = _fuzz(interval, rng)
    return max(1, min(max(interval, at_least), p.max_interval))


def _graduate(card: Card, days: int, now: int, clock: StudyClock) -> Card:
    return replace(card, phase=Phase.REVIEW, step=0, interval=days, due=_review_due(now, days, clock))


def _learn(card: Card, rating: Rating, now: int, p: Preset, clock: StudyClock) -> Card:
    """New and learning cards: minute steps, then graduate. Ease isn't touched."""
    steps = p.learn_steps
    # Clamp in case the steps were shortened in Settings while this card was learning.
    step = 0 if card.phase == Phase.NEW else min(card.step, max(0, len(steps) - 1))
    if not steps:
        # No steps (exercises): the first answer schedules straight into review.
        days = {
            Rating.AGAIN: p.min_interval,
            Rating.HARD: max(p.min_interval, js_round(p.graduating_interval / 2)),
            Rating.GOOD: p.graduating_interval,
            Rating.EASY: p.easy_interval,
        }[rating]
        return _graduate(card, days, now, clock)
    match rating:
        case Rating.AGAIN:
            return replace(card, phase=Phase.LEARNING, step=0, due=_ms(now + steps[0] * MINUTE))
        case Rating.HARD:
            return replace(
                card, phase=Phase.LEARNING, step=step, due=_ms(now + _hard_delay(steps, step) * MINUTE)
            )
        case Rating.GOOD:
            if step + 1 < len(steps):
                return replace(
                    card, phase=Phase.LEARNING, step=step + 1, due=_ms(now + steps[step + 1] * MINUTE)
                )
            return _graduate(card, p.graduating_interval, now, clock)
        case Rating.EASY:
            return _graduate(card, p.easy_interval, now, clock)


def _relearn(card: Card, rating: Rating, now: int, p: Preset, clock: StudyClock) -> Card:
    """Relearning after a lapse: minute steps, then back to review at the reduced interval."""
    steps = p.relearn_steps
    if not steps:  # steps removed in Settings
        return _graduate(card, card.interval, now, clock)
    step = min(card.step, len(steps) - 1)
    match rating:
        case Rating.AGAIN:
            return replace(card, step=0, due=_ms(now + steps[0] * MINUTE))
        case Rating.HARD:
            return replace(card, step=step, due=_ms(now + _hard_delay(steps, step) * MINUTE))
        case Rating.GOOD:
            if step + 1 < len(steps):
                return replace(card, step=step + 1, due=_ms(now + steps[step + 1] * MINUTE))
            return _graduate(card, card.interval, now, clock)
        case Rating.EASY:
            return _graduate(card, card.interval, now, clock)


def _review(
    card: Card, rating: Rating, now: int, p: Preset, clock: StudyClock, rng: Callable[[], float]
) -> Card:
    i = card.interval
    e = card.ease

    if rating == Rating.AGAIN:
        lapses = card.lapses + 1
        interval = max(p.min_interval, js_round(i * p.lapse_factor))
        lapsed = replace(
            card,
            lapses=lapses,
            ease=max(p.min_ease, e - 0.2),
            interval=interval,
            leech=card.leech or lapses >= p.leech_lapses,
        )
        if p.relearn_steps:
            return replace(lapsed, phase=Phase.RELEARNING, step=0, due=_ms(now + p.relearn_steps[0] * MINUTE))
        return _graduate(lapsed, interval, now, clock)

    today = study_day(now, clock)
    due_day = study_day(card.due, clock)
    early = days_between(today, due_day) > 0
    if not early:
        # Answered on time or late: late days count, partly (Anki v2).
        late = max(0, days_between(due_day, today))
        hard = _constrain((i + math.floor(late / 4)) * p.hard_factor, i + 1, p, rng)
        good = _constrain((i + math.floor(late / 2)) * e, hard + 1, p, rng)
        easy = _constrain((i + late) * e * p.easy_bonus, good + 1, p, rng)
    else:
        # Answered before it was due (e.g. in a chapter quiz): grow from the days actually elapsed,
        # and never shorten the current interval.
        if card.last_review is None:
            elapsed = i
        else:
            elapsed = max(1, days_between(study_day(card.last_review, clock), today))
        hard = _constrain(elapsed * p.hard_factor, i, p, rng)
        good = _constrain(elapsed * e, max(i, hard), p, rng)
        easy = _constrain(elapsed * e * p.easy_bonus, good + 1, p, rng)
    interval = {Rating.HARD: hard, Rating.GOOD: good, Rating.EASY: easy}[rating]
    if rating == Rating.HARD:
        ease = max(p.min_ease, e - 0.15)
    elif rating == Rating.EASY:
        ease = e + 0.15
    else:
        ease = e
    return replace(
        card, phase=Phase.REVIEW, step=0, ease=ease, interval=interval, due=_review_due(now, interval, clock)
    )


def answer(card: Card, rating: Rating, now: int, preset: Preset, clock: StudyClock) -> Card:
    """The card after answering it with `rating` at `now` (UTC epoch ms). Pure."""
    # Fuzz is seeded by card and repetition, so a preview and the real answer agree.
    rng = mulberry32(fnv1a(f"{card.id}:{card.reps}"))
    if card.phase in (Phase.NEW, Phase.LEARNING):
        after = _learn(card, rating, now, preset, clock)
    elif card.phase == Phase.RELEARNING:
        after = _relearn(card, rating, now, preset, clock)
    else:
        after = _review(card, rating, now, preset, clock, rng)
    return replace(after, reps=card.reps + 1, last_review=now, last_rating=rating, updated_at=now)


def preview(card: Card, now: int, preset: Preset, clock: StudyClock) -> dict[Rating, Card]:
    """What each rating would do, for labelling buttons."""
    return {r: answer(card, r, now, preset, clock) for r in RATINGS}
