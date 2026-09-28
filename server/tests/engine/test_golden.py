"""Replays every scheduling step the TS engine recorded before it was retired (T25). Never regenerate."""

from typing import Any

from recall_engine import CardKind, Rating, StudyClock, answer, new_card, preview

from .conftest import card_from, preset_from


def _mismatch(case_label: str, got: object, expected: object) -> str:
    return f"{case_label}\n  got:      {got}\n  expected: {expected}"


def test_every_answer_case_matches(g: dict[str, Any], clock: StudyClock) -> None:
    presets = {name: preset_from(p) for name, p in g["presets"].items()}
    failures: list[str] = []
    for i, case in enumerate(g["answer"]):
        card = card_from(case["card"])
        got = answer(card, Rating(case["rating"]), case["now"], presets[case["preset"]], clock)
        expected = card_from(case["expected"])
        if got != expected:
            failures.append(
                _mismatch(f"answer[{i}] {case['preset']} {card.id} {case['rating']}", got, expected)
            )
    assert not failures, f"{len(failures)} of {len(g['answer'])} differ; first:\n" + "\n".join(failures[:3])


def test_every_chain_step_matches(g: dict[str, Any], clock: StudyClock) -> None:
    presets = {name: preset_from(p) for name, p in g["presets"].items()}
    failures: list[str] = []
    steps = 0
    for chain in g["chains"]:
        preset = presets[chain["preset"]]
        card = new_card(chain["id"], CardKind(chain["kind"]), preset)
        for n, step in enumerate(chain["steps"]):
            steps += 1
            got = answer(card, Rating(step["rating"]), step["now"], preset, clock)
            expected = card_from(step["expected"])
            if got != expected:
                failures.append(_mismatch(f"{chain['id']} step {n} {step['rating']}", got, expected))
            card = expected  # continue from the TS state so one slip doesn't cascade
    assert not failures, f"{len(failures)} of {steps} chain steps differ; first:\n" + "\n".join(failures[:3])


def test_golden_covers_at_least_5000_steps(g: dict[str, Any]) -> None:
    assert g["stepCount"] >= 5000


def test_preview_is_answer_for_each_rating(g: dict[str, Any], clock: StudyClock) -> None:
    presets = {name: preset_from(p) for name, p in g["presets"].items()}
    for case in g["answer"][:200]:
        card = card_from(case["card"])
        preset = presets[case["preset"]]
        buttons = preview(card, case["now"], preset, clock)
        assert buttons[Rating(case["rating"])] == answer(
            card, Rating(case["rating"]), case["now"], preset, clock
        )
