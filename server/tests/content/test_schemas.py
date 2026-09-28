"""Content schemas: every question type, unknown fields, the two output shapes, stable hashes."""

from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from recall_content.hashing import content_hash
from recall_content.schemas import CourseFile, Exercise, Question, UnitFile

QUESTION = TypeAdapter(Question)

COMMON: dict[str, Any] = {"section": "2.4", "prompt": "p", "explanation": "e", "difficulty": 1}
VALID: dict[str, dict[str, Any]] = {
    "single": {"options": ["a", "b"], "answer": "a"},
    "multi": {"options": ["a", "b", "c"], "answers": ["a", "c"]},
    "truefalse": {"answer": False},
    "typed": {"accept": ["x"], "case_sensitive": True},
    "output": {"code": {"lang": "bash", "source": "$ pwd"}, "accept": ["/"]},
    "order": {"items": ["one", "two"]},
    "match": {
        "pairs": [
            {"term": "a", "definition": "A"},
            {"term": "b", "definition": "B"},
            {"term": "c", "definition": "C"},
        ]
    },
}


@pytest.mark.parametrize("qtype", VALID)
def test_every_question_type_parses(qtype: str) -> None:
    q = QUESTION.validate_python({"key": f"ch02-{qtype}", "type": qtype, **COMMON, **VALID[qtype]})
    assert q.type == qtype
    assert q.key == f"ch02-{qtype}"


@pytest.mark.parametrize("qtype", VALID)
def test_unknown_field_is_rejected(qtype: str) -> None:
    with pytest.raises(ValidationError, match="hints"):
        QUESTION.validate_python({"key": "k1", "type": qtype, **COMMON, **VALID[qtype], "hints": "oops"})


def test_output_needs_exactly_one_shape() -> None:
    code = {"lang": "bash", "source": "$ pwd"}
    base = {"key": "k1", "type": "output", **COMMON, "code": code}
    assert QUESTION.validate_python({**base, "options": ["1", "2"], "answer": "2"}).type == "output"
    with pytest.raises(ValidationError, match="either options"):
        QUESTION.validate_python(base)
    with pytest.raises(ValidationError, match="either options"):
        QUESTION.validate_python({**base, "options": ["1", "2"], "answer": "2", "accept": ["2"]})
    with pytest.raises(ValidationError, match="code"):
        QUESTION.validate_python({"key": "k1", "type": "output", **COMMON, "accept": ["/"]})


def test_bad_key_and_difficulty_are_rejected() -> None:
    with pytest.raises(ValidationError, match="key"):
        QUESTION.validate_python({"key": "Ch02 Q1", "type": "truefalse", **COMMON, "answer": True})
    with pytest.raises(ValidationError, match="difficulty"):
        QUESTION.validate_python(
            {"key": "k1", "type": "truefalse", **{**COMMON, "difficulty": 4}, "answer": True}
        )


def test_api_output_is_camel_case() -> None:
    q = QUESTION.validate_python(
        {"key": "k1", "type": "typed", **COMMON, "accept": ["x"], "note_anchor": "Caps"}
    )
    dumped = q.model_dump(mode="json", by_alias=True)
    assert dumped["noteAnchor"] == "Caps"
    assert dumped["caseSensitive"] is False


def test_exercise_course_and_unit_files_parse() -> None:
    ex = Exercise.model_validate(
        {
            "key": "ch04-ex01",
            "title": "Write your own `tee`",
            "sections": ["4.3"],
            "book_ref": "4-1",
            "difficulty": 2,
            "goal": "g",
            "requirements": ["r"],
            "tests": [{"name": "t", "run": "./tee x", "expect": "copies stdin"}],
        }
    )
    assert ex.book_ref == "4-1"
    course = CourseFile.model_validate(
        {"slug": "tlpi", "title": "T", "short": "TLPI", "outline": [{"number": 1, "title": "History"}]}
    )
    assert course.scheduling == {}
    unit = UnitFile.model_validate({"number": 2, "title": "F", "sections": [{"key": "2.1", "title": "K"}]})
    assert unit.sections[0].key == "2.1"


def test_hash_is_stable_across_key_order_and_runs() -> None:
    a = QUESTION.validate_python(
        {"key": "k1", "type": "single", **COMMON, "options": ["a", "b"], "answer": "a"}
    )
    reordered = {
        "answer": "a",
        "options": ["a", "b"],
        **dict(reversed(list(COMMON.items()))),
        "type": "single",
        "key": "k1",
    }
    b = QUESTION.validate_python(reordered)
    assert content_hash(a) == content_hash(b)
    assert content_hash(a) == "sha256:" + content_hash(a).split(":")[1]
    changed = QUESTION.validate_python(
        {"key": "k1", "type": "single", **COMMON, "options": ["a", "b"], "answer": "b"}
    )
    assert content_hash(changed) != content_hash(a)
