"""One failing case per content rule (SPEC-content-model §Content rules)."""

from pathlib import Path

import pytest

from recall_content import ContentErrors, parse_course

from .conftest import UNIT, Edit

Q = f"{UNIT}/questions.yaml"
X = f"{UNIT}/exercises.yaml"


def only_error(course: Path) -> str:
    with pytest.raises(ContentErrors) as exc:
        parse_course(course)
    assert len(exc.value.errors) == 1, [str(e) for e in exc.value.errors]
    return str(exc.value.errors[0])


def test_answer_not_among_options(course: Path, edit: Edit) -> None:
    edit(Q, "  answer: b\n", "  answer: zzz\n")
    assert only_error(course) == f'{Q}:7 demo-q001: answer "zzz" is not among the options'


def test_duplicate_options(course: Path, edit: Edit) -> None:
    edit(Q, "  options: [a, b, c]\n  answer: b", "  options: [a, b, b]\n  answer: b")
    assert only_error(course) == f"{Q}:6 demo-q001: options contain duplicates"


def test_multi_answers_must_be_options_and_non_empty(course: Path, edit: Edit) -> None:
    edit(Q, "  answers: [a, c]", "  answers: [a, z]")
    assert only_error(course) == f'{Q}:17 demo-q002: answer "z" is not among the options'


def test_multi_without_answers(course: Path, edit: Edit) -> None:
    edit(Q, "  answers: [a, c]", "  answers: []")
    assert only_error(course) == f"{Q}:17 demo-q002: multi question has no answers"


def test_empty_accept(course: Path, edit: Edit) -> None:
    edit(Q, "  accept: [x, ex]", "  accept: []")
    assert only_error(course) == f'{Q}:33 demo-q004: "accept" list is empty'


def test_output_choice_answer(course: Path, edit: Edit) -> None:
    edit(Q, '  answer: "0"', '  answer: "2"')
    assert only_error(course) == f'{Q}:57 demo-q006: answer "2" is not among the options'


def test_order_duplicates(course: Path, edit: Edit) -> None:
    edit(Q, "  items: [one, two, three]", "  items: [one, one, three]")
    assert only_error(course) == f"{Q}:65 demo-q007: items contain duplicates"


def test_match_pair_count_and_distinct_definitions(course: Path, edit: Edit) -> None:
    edit(Q, "    - { term: c, definition: C }\n", "")
    assert only_error(course) == f"{Q}:73 demo-q008: match needs 3–6 pairs"


def test_match_distinct_definitions(course: Path, edit: Edit) -> None:
    edit(Q, "    - { term: c, definition: C }", "    - { term: c, definition: B }")
    assert only_error(course) == f"{Q}:73 demo-q008: match definitions must be distinct"


def test_unknown_section(course: Path, edit: Edit) -> None:
    edit(
        Q,
        '  section: "1.2"\n  difficulty: 1\n  prompt: The sky',
        '  section: "1.9"\n  difficulty: 1\n  prompt: The sky',
    )
    assert only_error(course) == f'{Q}:22 demo-q003: section "1.9" is not in unit 1'


def test_duplicate_key_across_questions_and_exercises(course: Path, edit: Edit) -> None:
    edit(X, "- key: demo-ex01", "- key: demo-q003")
    assert only_error(course) == f"{X}:1 demo-q003: duplicate key demo-q003 (also in {Q}:20)"


def test_exercise_unknown_section_and_duplicate_test_names(course: Path, edit: Edit) -> None:
    edit(X, '  sections: ["1.1"]', '  sections: ["1.1", "4.2"]')
    edit(X, "name: exit status", "name: prints hello")
    with pytest.raises(ContentErrors) as exc:
        parse_course(course)
    assert [str(e) for e in exc.value.errors] == [
        f'{X}:3 demo-ex01: section "4.2" is not in unit 1',
        f"{X}:9 demo-ex01: test names must be unique",
    ]


def test_duplicate_section_key(course: Path, edit: Edit) -> None:
    edit(
        f"{UNIT}/unit.yaml",
        '  - { key: "1.2", title: Second Section }',
        '  - { key: "1.1", title: Second Section }',
    )
    errors = pytest.raises(ContentErrors, parse_course, course).value.errors
    assert f'{UNIT}/unit.yaml:6: section key "1.1" appears twice' in [str(e) for e in errors]


def test_unit_not_in_outline(course: Path, edit: Edit) -> None:
    edit("course.yaml", "  - { number: 1, title: Basics }\n", "")
    assert (
        only_error(course) == "units/01-basics: unit folder has number 1, which is not in course.yaml outline"
    )


def test_folder_number_must_match_unit_number(course: Path, edit: Edit) -> None:
    edit(f"{UNIT}/unit.yaml", "number: 1", "number: 2")
    assert only_error(course) == "units/01-basics: folder number 01 does not match unit.yaml number 2"


def test_duplicate_unit_numbers_and_outline_entries(course: Path, edit: Edit) -> None:
    edit("course.yaml", "  - { number: 2, title: Coming Later }", "  - { number: 1, title: Coming Later }")
    assert only_error(course) == "course.yaml:11: outline number 1 appears twice"


def test_unknown_scheduling_option(course: Path, edit: Edit) -> None:
    edit("course.yaml", "    new_per_day: 5", "    new_cards: 5")
    assert only_error(course) == "course.yaml:8: scheduling.question: unknown scheduling option(s): new_cards"
