"""Behaviour tests, one rule each, ported from the retired TS engine's tests."""

from dataclasses import replace
from datetime import datetime
from typing import Any

import pytest

from recall_engine import (
    EXERCISE_PRESET,
    QUESTION_PRESET,
    Card,
    CardKind,
    Phase,
    Preset,
    Rating,
    StudyClock,
    add_days,
    answer,
    day_start_ms,
    new_card,
    preview,
    resolve_preset,
    study_day,
)

CLOCK = StudyClock(tz="America/Los_Angeles")
MIN = 60_000
# Noon on a fixed day, well clear of the 04:00 rollover.
NOW = int(datetime(2026, 9, 27, 12, 0, tzinfo=CLOCK.zone).timestamp()) * 1000
TODAY = study_day(NOW, CLOCK)
NO_FUZZ = replace(QUESTION_PRESET, fuzz=False)


def due_in(days: int) -> int:
    return day_start_ms(add_days(TODAY, days), CLOCK)


def q() -> Card:
    return new_card("q1", CardKind.QUESTION, QUESTION_PRESET)


def ex() -> Card:
    return new_card("e1", CardKind.EXERCISE, EXERCISE_PRESET)


def review_card(interval: int, ease: float = 2.5, **over: Any) -> Card:
    """A review card whose interval ends today."""
    base = replace(
        q(),
        phase=Phase.REVIEW,
        interval=interval,
        ease=ease,
        due=day_start_ms(TODAY, CLOCK),
        last_review=day_start_ms(add_days(TODAY, -interval), CLOCK),
        reps=5,
    )
    return replace(base, **over)


def ans(card: Card, rating: Rating, preset: Preset = QUESTION_PRESET, now: int = NOW) -> Card:
    return answer(card, rating, now, preset, CLOCK)


# ---- learning ---------------------------------------------------------------------


def test_learning_again_hard_good_follow_the_steps() -> None:
    assert ans(q(), Rating.AGAIN) == replace(
        ans(q(), Rating.AGAIN), phase=Phase.LEARNING, step=0, due=NOW + MIN
    )
    hard = ans(q(), Rating.HARD)
    assert (hard.phase, hard.step, hard.due) == (Phase.LEARNING, 0, NOW + int(5.5 * MIN))
    good = ans(q(), Rating.GOOD)
    assert (good.phase, good.step, good.due) == (Phase.LEARNING, 1, NOW + 10 * MIN)


def test_good_on_last_step_graduates_to_1_day_easy_to_4() -> None:
    step1 = ans(q(), Rating.GOOD)
    grad = ans(step1, Rating.GOOD)
    assert (grad.phase, grad.interval, grad.due) == (Phase.REVIEW, 1, due_in(1))
    easy = ans(q(), Rating.EASY)
    assert (easy.phase, easy.interval, easy.due) == (Phase.REVIEW, 4, due_in(4))


def test_learning_never_changes_ease() -> None:
    card = q()
    for r in (Rating.AGAIN, Rating.HARD, Rating.AGAIN, Rating.GOOD, Rating.GOOD):
        card = ans(card, r)
    assert card.ease == 2.5
    assert card.reps == 5


# ---- review (no fuzz) -------------------------------------------------------------


def test_review_multipliers_and_ease_changes() -> None:
    c = review_card(10)
    hard = ans(c, Rating.HARD, NO_FUZZ)
    assert (hard.interval, hard.ease, hard.due) == (12, 2.35, due_in(12))
    assert (ans(c, Rating.GOOD, NO_FUZZ).interval, ans(c, Rating.GOOD, NO_FUZZ).ease) == (25, 2.5)
    assert (ans(c, Rating.EASY, NO_FUZZ).interval, ans(c, Rating.EASY, NO_FUZZ).ease) == (33, 2.65)


def test_each_answer_is_at_least_a_day_longer() -> None:
    c = review_card(1, 1.3)
    assert [ans(c, r, NO_FUZZ).interval for r in (Rating.HARD, Rating.GOOD, Rating.EASY)] == [2, 3, 4]


def test_late_days_are_credited() -> None:
    c = review_card(
        10,
        2.5,
        due=day_start_ms(add_days(TODAY, -8), CLOCK),
        last_review=day_start_ms(add_days(TODAY, -18), CLOCK),
    )
    assert ans(c, Rating.HARD, NO_FUZZ).interval == 14  # round((10 + 2) * 1.2)
    assert ans(c, Rating.GOOD, NO_FUZZ).interval == 35  # (10 + 4) * 2.5
    assert ans(c, Rating.EASY, NO_FUZZ).interval == 59  # round((10 + 8) * 2.5 * 1.3) = round(58.5)


def test_answering_early_never_shortens() -> None:
    c = review_card(
        30,
        2.5,
        due=day_start_ms(add_days(TODAY, 28), CLOCK),
        last_review=day_start_ms(add_days(TODAY, -2), CLOCK),
    )
    assert ans(c, Rating.GOOD, NO_FUZZ).interval == 30
    assert ans(c, Rating.HARD, NO_FUZZ).interval == 30


def test_lapse_relearns_then_returns_at_minimum() -> None:
    lapsed = ans(review_card(40, 1.4), Rating.AGAIN, NO_FUZZ)
    assert (lapsed.phase, lapsed.step, lapsed.due, lapsed.lapses, lapsed.ease, lapsed.interval) == (
        Phase.RELEARNING,
        0,
        NOW + 10 * MIN,
        1,
        1.3,
        1,
    )
    back = ans(lapsed, Rating.GOOD, NO_FUZZ)
    assert (back.phase, back.interval, back.due) == (Phase.REVIEW, 1, due_in(1))


def test_leech_at_8_lapses() -> None:
    assert not ans(review_card(5, lapses=6), Rating.AGAIN, NO_FUZZ).leech
    assert ans(review_card(5, lapses=7), Rating.AGAIN, NO_FUZZ).leech


def test_max_interval_cap() -> None:
    assert ans(review_card(30000), Rating.EASY, NO_FUZZ).interval == QUESTION_PRESET.max_interval


# ---- fuzz -------------------------------------------------------------------------


def test_fuzz_range_determinism_and_preview_agree() -> None:
    c = review_card(10)
    a = ans(c, Rating.GOOD)
    assert 22 <= a.interval <= 28
    assert ans(c, Rating.GOOD) == a
    assert preview(c, NOW, QUESTION_PRESET, CLOCK)[Rating.GOOD] == a


def test_fuzz_spreads_cards_learned_together() -> None:
    intervals = {ans(review_card(20, id=f"q{i}"), Rating.GOOD).interval for i in range(30)}
    assert len(intervals) > 3


# ---- exercises --------------------------------------------------------------------


def test_exercise_first_rating_schedules_days_out() -> None:
    got = {
        r: ans(ex(), r, EXERCISE_PRESET).interval
        for r in (Rating.AGAIN, Rating.HARD, Rating.GOOD, Rating.EASY)
    }
    assert got == {Rating.AGAIN: 1, Rating.HARD: 2, Rating.GOOD: 3, Rating.EASY: 7}
    assert ans(ex(), Rating.GOOD, EXERCISE_PRESET).due == due_in(3)


def test_exercise_lapse_halves_and_skips_relearning() -> None:
    c = replace(
        ex(),
        phase=Phase.REVIEW,
        interval=20,
        due=day_start_ms(TODAY, CLOCK),
        last_review=day_start_ms(add_days(TODAY, -20), CLOCK),
        reps=3,
    )
    lapsed = ans(c, Rating.AGAIN, EXERCISE_PRESET)
    assert (lapsed.phase, lapsed.interval, lapsed.lapses, lapsed.due) == (Phase.REVIEW, 10, 1, due_in(10))


# ---- presets ----------------------------------------------------------------------


def test_overrides_layer_on_defaults() -> None:
    p = resolve_preset(CardKind.QUESTION, {"learn_steps": [5], "graduating_interval": 2})
    assert p.learn_steps == (5,)
    assert p.easy_interval == 4
    graduated = ans(q(), Rating.GOOD, p)
    assert (graduated.phase, graduated.interval) == (Phase.REVIEW, 2)
    course_then_learner = resolve_preset(CardKind.QUESTION, {"new_per_day": 40}, {"new_per_day": 5})
    assert course_then_learner.new_per_day == 5


def test_unknown_override_is_rejected() -> None:
    with pytest.raises(ValueError, match="new_cards"):
        resolve_preset(CardKind.QUESTION, {"new_cards": 3})


def test_steps_shortened_or_removed_mid_card() -> None:
    learning = replace(ans(ans(q(), Rating.GOOD), Rating.AGAIN), step=5)
    assert ans(learning, Rating.GOOD, replace(QUESTION_PRESET, learn_steps=(1, 10))).phase == Phase.REVIEW
    relearning = replace(q(), phase=Phase.RELEARNING, step=3, interval=4, reps=4)
    back = ans(relearning, Rating.GOOD, replace(QUESTION_PRESET, relearn_steps=()))
    assert (back.phase, back.interval) == (Phase.REVIEW, 4)


def test_answer_records_the_review() -> None:
    after = ans(q(), Rating.HARD)
    assert (after.reps, after.last_review, after.last_rating, after.updated_at) == (1, NOW, Rating.HARD, NOW)
