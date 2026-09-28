"""Today's queue and daily counts, replayed from the TS engine, plus due/mastered rules."""

from dataclasses import replace
from typing import Any

from recall_engine import (
    QUESTION_PRESET,
    CardKind,
    DoneToday,
    Phase,
    ReviewLog,
    StudyClock,
    done_today,
    is_due,
    is_mastered,
    new_card,
    today_queue,
)

from .conftest import card_from, preset_from


def test_today_queue_matches_ts(g: dict[str, Any]) -> None:
    for i, case in enumerate(g["queue"]):
        cards = {k: card_from(v) for k, v in case["cards"].items()}
        done = DoneToday(new_done=case["done"]["newDone"], reviews_done=case["done"]["reviewsDone"])
        got = today_queue(
            case["candidates"], cards, case["now"], preset_from(case["preset"]), done, case["learnAhead"]
        )
        expected = case["expected"]
        assert (list(got.learning), list(got.review), list(got.fresh)) == (
            expected["learning"],
            expected["review"],
            expected["fresh"],
        ), f"queue[{i}]"


def test_done_today_matches_ts(g: dict[str, Any], clock: StudyClock) -> None:
    for i, case in enumerate(g["doneToday"]):
        logs = [
            ReviewLog(at=r["at"], kind=CardKind(r["kind"]), phase_before=Phase(r["before"]["phase"]))
            for r in case["reviews"]
        ]
        got = done_today(logs, case["now"], clock)
        for kind in CardKind:
            exp = case["expected"][kind.value]
            assert got[kind] == DoneToday(new_done=exp["newDone"], reviews_done=exp["reviewsDone"]), (
                f"doneToday[{i}] {kind}"
            )


def test_is_due_and_is_mastered() -> None:
    card = new_card("q", CardKind.QUESTION, QUESTION_PRESET)
    assert not is_due(card, 10**15)
    assert not is_due(None, 0)
    learning = replace(card, phase=Phase.LEARNING, due=1000)
    assert not is_due(learning, 999)
    assert is_due(learning, 1000)
    assert not is_due(replace(learning, suspended=True), 1000)
    assert not is_mastered(replace(card, phase=Phase.REVIEW, interval=20))
    assert is_mastered(replace(card, phase=Phase.REVIEW, interval=21))
    assert not is_mastered(replace(card, phase=Phase.RELEARNING, interval=40))
    assert not is_mastered(None)
