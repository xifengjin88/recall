"""What a course is. Files use snake_case field names; the API emits camelCase aliases.

Shape and type checks live here; cross-field and cross-file rules (answer among options,
unknown sections, duplicate keys, notes headings) live in rules.py so every problem can be
reported with its file and line.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

Key = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)]
Text = Annotated[str, StringConstraints(min_length=1)]
Difficulty = Literal[1, 2, 3]


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, alias_generator=to_camel, populate_by_name=True)


class CodeBlock(Model):
    lang: Literal["c", "bash", "text"]
    source: Text


class _QuestionBase(Model):
    key: Key
    section: Text
    prompt: Text
    code: CodeBlock | None = None
    explanation: Text
    hint: str | None = None
    difficulty: Difficulty
    tags: tuple[str, ...] = ()
    note_anchor: str | None = None
    retired: bool = False


class Single(_QuestionBase):
    type: Literal["single"]
    options: Annotated[tuple[Text, ...], Field(min_length=2, max_length=6)]
    answer: Text
    keep_order: bool = False


class Multi(_QuestionBase):
    type: Literal["multi"]
    options: Annotated[tuple[Text, ...], Field(min_length=2, max_length=6)]
    answers: tuple[Text, ...]
    keep_order: bool = False


class TrueFalse(_QuestionBase):
    type: Literal["truefalse"]
    answer: bool


class Typed(_QuestionBase):
    type: Literal["typed"]
    accept: tuple[str, ...]
    case_sensitive: bool = False


class Output(_QuestionBase):
    """Predict the output: either choose from options (options + answer) or type it (accept)."""

    type: Literal["output"]
    options: Annotated[tuple[Text, ...], Field(min_length=2, max_length=6)] | None = None
    answer: Text | None = None
    keep_order: bool = False
    accept: tuple[str, ...] | None = None
    case_sensitive: bool = False

    @model_validator(mode="after")
    def _one_shape(self) -> "Output":
        if self.code is None:
            raise ValueError("output question needs a code block (code: {lang, source})")
        choice = self.options is not None or self.answer is not None
        typed = self.accept is not None
        if choice == typed:
            raise ValueError(
                "output needs either options + answer (choice) or accept (typed), not both or neither"
            )
        if choice and (self.options is None or self.answer is None):
            raise ValueError("output choice needs both options and answer")
        return self


class Order(_QuestionBase):
    type: Literal["order"]
    items: Annotated[tuple[Text, ...], Field(min_length=2)]
    keep_order: bool = False


class Pair(Model):
    term: Text
    definition: Text


class Match(_QuestionBase):
    type: Literal["match"]
    pairs: tuple[Pair, ...]


Question = Annotated[Single | Multi | TrueFalse | Typed | Output | Order | Match, Field(discriminator="type")]
QUESTION_TYPES: tuple[str, ...] = ("single", "multi", "truefalse", "typed", "output", "order", "match")


class ExerciseTest(Model):
    name: Text
    run: Text
    expect: Text


class Exercise(Model):
    key: Key
    title: Text
    sections: Annotated[tuple[Text, ...], Field(min_length=1)]
    book_ref: str | None = None
    difficulty: Difficulty
    estimate: str | None = None
    goal: Text
    background: tuple[str, ...] = ()
    requirements: Annotated[tuple[Text, ...], Field(min_length=1)]
    constraints: tuple[str, ...] = ()
    example: CodeBlock | None = None
    tests: Annotated[tuple[ExerciseTest, ...], Field(min_length=1)]
    hints: tuple[str, ...] = ()
    stretch: tuple[str, ...] = ()
    note_anchor: str | None = None
    retired: bool = False


class OutlineEntry(Model):
    number: Annotated[int, Field(ge=1)]
    title: Text


class Section(Model):
    key: Text
    title: Text


class CourseFile(Model):
    """course.yaml"""

    slug: Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]*$", max_length=64)]
    title: Text
    short: Text
    author: str | None = None
    description: str | None = None
    # Course default scheduling options per card kind, same names as recall_engine.Preset fields.
    scheduling: dict[Literal["question", "exercise"], dict[str, Any]] = {}
    outline: Annotated[tuple[OutlineEntry, ...], Field(min_length=1)]


class UnitFile(Model):
    """units/<NN>-<title>/unit.yaml"""

    number: Annotated[int, Field(ge=1)]
    title: Text
    note_title: str | None = None
    sections: Annotated[tuple[Section, ...], Field(min_length=1)]


class ParsedUnit(Model):
    number: int
    title: str
    note_title: str | None
    folder: str
    sections: tuple[Section, ...]
    questions: tuple[Question, ...]
    exercises: tuple[Exercise, ...]
    notes: str | None


class CourseMeta(Model):
    slug: str
    title: str
    short: str
    author: str | None
    description: str | None
    scheduling: dict[Literal["question", "exercise"], dict[str, Any]]


class ParsedCourse(Model):
    course: CourseMeta
    outline: tuple[OutlineEntry, ...]
    units: tuple[ParsedUnit, ...]
    content_hash: str
