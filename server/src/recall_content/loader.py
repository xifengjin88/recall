"""Read a course folder: YAML with line numbers, schema validation per item, then the content rules."""

import difflib
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import yaml
from pydantic import BaseModel, TypeAdapter, ValidationError

from .errors import ContentError
from .schemas import QUESTION_TYPES, Exercise, Match, Multi, Order, Output, Question, Single, TrueFalse, Typed

Path_ = tuple[str | int, ...]


@dataclass(frozen=True)
class YamlDoc:
    """Parsed YAML plus the (1-based) line of every mapping key and sequence item."""

    data: Any
    lines: dict[Path_, int]

    def line(self, path: Path_) -> int | None:
        """Line of the deepest known prefix of `path`."""
        for n in range(len(path), -1, -1):
            if path[:n] in self.lines:
                return self.lines[path[:n]]
        return None


def _walk(node: yaml.Node, path: Path_, lines: dict[Path_, int]) -> None:
    if isinstance(node, yaml.MappingNode):
        for key_node, value_node in node.value:  # pyright: ignore[reportUnknownVariableType]
            key = str(key_node.value)  # pyright: ignore[reportUnknownMemberType, reportUnknownArgumentType]
            lines[(*path, key)] = key_node.start_mark.line + 1  # pyright: ignore[reportUnknownMemberType]
            _walk(value_node, (*path, key), lines)  # pyright: ignore[reportUnknownArgumentType]
    elif isinstance(node, yaml.SequenceNode):
        for i, item in enumerate(node.value):  # pyright: ignore[reportUnknownVariableType, reportUnknownArgumentType]
            lines[(*path, i)] = item.start_mark.line + 1  # pyright: ignore[reportUnknownMemberType]
            _walk(item, (*path, i), lines)  # pyright: ignore[reportUnknownArgumentType]


class YamlProblem(Exception):
    def __init__(self, line: int | None, message: str) -> None:
        super().__init__(message)
        self.line = line
        self.message = message


def load_yaml(path: Path) -> YamlDoc:
    loader = yaml.SafeLoader(path.read_text())
    try:
        node = loader.get_single_node()
        data = loader.construct_document(node) if node is not None else None
    except yaml.MarkedYAMLError as err:
        mark = err.problem_mark or err.context_mark
        raise YamlProblem(mark.line + 1 if mark else None, f"invalid YAML: {err.problem or err}") from err
    finally:
        loader.dispose()  # pyright: ignore[reportUnknownMemberType]
    lines: dict[Path_, int] = {(): node.start_mark.line + 1} if node is not None else {}
    if node is not None:
        _walk(node, (), lines)
    return YamlDoc(data, lines)


# ---- turning pydantic errors into ContentErrors -----------------------------------

_MODEL_BY_TYPE: dict[str, type[BaseModel]] = {
    "single": Single,
    "multi": Multi,
    "truefalse": TrueFalse,
    "typed": Typed,
    "output": Output,
    "order": Order,
    "match": Match,
}


def _question_model(raw: Any) -> type[BaseModel] | None:
    """The concrete model for a raw question dict, used to suggest field names."""
    if not isinstance(raw, dict):
        return None
    kind = cast("dict[str, Any]", raw).get("type")
    return _MODEL_BY_TYPE.get(kind) if isinstance(kind, str) else None


def pydantic_errors(
    err: ValidationError, file: str, doc: YamlDoc, base: Path_, key: str | None, model: type[BaseModel] | None
) -> Iterator[ContentError]:
    for e in err.errors():
        loc = tuple(e["loc"])
        # Discriminated unions put the tag first: ("single", "options", ...).
        if loc and loc[0] in QUESTION_TYPES:
            loc = loc[1:]
        dotted = ".".join(str(p) for p in loc)
        kind = e["type"]
        if kind == "missing":
            message = f'missing required field "{dotted}"'
            line = doc.line(base)
        elif kind == "extra_forbidden":
            name = str(loc[-1])
            message = f'unknown field "{dotted}"'
            if len(loc) == 1:
                known = list(model.model_fields) if model else []
                close = difflib.get_close_matches(name, known, n=1, cutoff=0.6)
                if close:
                    message += f' (did you mean "{close[0]}"?)'
            line = doc.line((*base, *loc))
        elif kind == "union_tag_invalid" or kind == "union_tag_not_found":
            message = f'"type" must be one of: {", ".join(QUESTION_TYPES)}'
            line = doc.line((*base, "type"))
        else:
            text = str(e["msg"]).removeprefix("Value error, ")
            message = f"{dotted}: {text}" if dotted else text
            line = doc.line((*base, *loc))
        yield ContentError(file, line, key, message)


# ---- located items ---------------------------------------------------------------


@dataclass(frozen=True)
class Located[T]:
    """A validated item and where it came from, so rules can point at the right line."""

    item: T
    file: str
    doc: YamlDoc
    path: Path_  # path of the item inside its document

    def error(self, message: str, field: str | None = None, key: str | None = None) -> ContentError:
        path = (*self.path, field) if field else self.path
        return ContentError(self.file, self.doc.line(path), key, message)


_QUESTION = TypeAdapter(Question)


def load_list(
    folder: Path, name: str, rel_folder: str, kind: str, errors: list[ContentError]
) -> list[Located[Any]]:
    """questions.yaml / exercises.yaml: a list of items, each validated on its own."""
    path = folder / name
    if not path.exists():
        return []
    rel = f"{rel_folder}/{name}"
    try:
        doc = load_yaml(path)
    except YamlProblem as p:
        errors.append(ContentError(rel, p.line, None, p.message))
        return []
    if doc.data is None:
        return []
    if not isinstance(doc.data, list):
        errors.append(ContentError(rel, doc.line(()), None, f"{name} must be a list of {kind}s"))
        return []
    out: list[Located[Any]] = []
    for i, raw in enumerate(doc.data):
        key = raw.get("key") if isinstance(raw, dict) and isinstance(raw.get("key"), str) else None
        try:
            item: Any = _QUESTION.validate_python(raw) if kind == "question" else Exercise.model_validate(raw)
        except ValidationError as err:
            model = _question_model(raw) if kind == "question" else Exercise
            errors.extend(pydantic_errors(err, rel, doc, (i,), key, model))
            continue
        out.append(Located(item, rel, doc, (i,)))
    return out


def load_model[M: BaseModel](
    path: Path, rel: str, model: type[M], errors: list[ContentError]
) -> tuple[M, YamlDoc] | None:
    try:
        doc = load_yaml(path)
    except YamlProblem as p:
        errors.append(ContentError(rel, p.line, None, p.message))
        return None
    try:
        return model.model_validate(doc.data if doc.data is not None else {}), doc
    except ValidationError as err:
        errors.extend(pydantic_errors(err, rel, doc, (), None, model))
        return None


UNIT_FOLDER = re.compile(r"^(\d+)-[a-z0-9-]+$")
