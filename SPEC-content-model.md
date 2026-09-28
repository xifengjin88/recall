# Spec: content-model

Module of [SPEC.md](SPEC.md). Depends on: `platform`.

## Objective

Define what a course is, in files and in memory, and check it. This module parses a course folder of YAML and Markdown into validated Pydantic models and reports every problem clearly. It touches no database; `content-import` stores what this module produces, and the APIs serve it.

Success means an author can write or edit a course in a text editor, run one validate command, and get either "OK" or a list of problems that each name the file, the item and what to fix.

## Course folder format

```
courses/<slug>/
  course.yaml
  units/<NN>-<kebab-title>/        one folder per unit that has content
    unit.yaml
    questions.yaml                 optional
    exercises.yaml                 optional
    notes.md                       optional
```

`course.yaml`: the course and its full outline (units without a folder show as "Coming soon"):

```yaml
slug: tlpi
title: The Linux Programming Interface
short: TLPI
author: Michael Kerrisk
description: System programming on Linux and UNIX, chapter by chapter.
scheduling:             # optional course defaults, same keys as Settings › Scheduling
  question: { new_per_day: 20 }
outline:
  - { number: 1, title: History and Standards }
  - { number: 2, title: Fundamental Concepts }
  # … all 64 chapters
```

`unit.yaml`:

```yaml
number: 2
title: Fundamental Concepts
note_title: TLPI 02 - Fundamental Concepts
sections:
  - { key: "2.1", title: "The Core Operating System: The Kernel" }
  - { key: "2.4", title: "Single Directory Hierarchy, Directories, Links, and Files" }
```

`questions.yaml`: a list; field names are the current ones in snake_case, and `id` becomes `key`:

```yaml
- key: ch02-q016
  type: single
  section: "2.4"
  difficulty: 3
  tags: [permissions, gotcha]
  prompt: You want to delete a file you don't own from a shared directory. Which permission matters?
  options: [Write permission on the file, Execute permission on the file,
            Write permission on the directory, Read permission on the directory]
  answer: Write permission on the directory
  hint: Deleting removes a filename from a table. What holds that table?
  explanation: Directory write permission allows adding, removing and renaming entries.
```

`exercises.yaml` follows the exercise fields in `docs/SPEC.md` §5.4 the same way (`book_ref`, `tests: [{name, run, expect}]`, …). `notes.md` is the unit's study note, stored as-is (Obsidian-flavoured Markdown).

## Models (Pydantic v2)

```python
class Question(BaseModel):          # discriminated union on `type`
    ...
QuestionT = Annotated[
    Single | Multi | TrueFalse | Typed | OutputChoice | OutputTyped | Order | Match,
    Field(discriminator="type"),
]

class ParsedCourse(BaseModel):
    course: CourseMeta
    outline: list[OutlineEntry]
    units: list[ParsedUnit]          # sections, questions, exercises, notes
    content_hash: str                # over the whole course
```

- `model_config = ConfigDict(extra="forbid", frozen=True, alias_generator=to_camel, populate_by_name=True)`: unknown keys are errors, and the API can emit camelCase.
- Every question and exercise gets a `content_hash`: SHA-256 of its canonical JSON (sorted keys, no whitespace). `content-import` uses it to skip unchanged items.
- The `output` type has two shapes (choice or typed); the parser picks one by which fields are present and reports an error if both or neither are.

## Content rules

All rules from today's `validate.ts`, plus the ones a multi-course, file-based setup needs. Each produces a `ContentError(file, line, item_key, message)`.

| Rule | Example message |
|---|---|
| Required fields present; types correct; no unknown keys | `questions.yaml:41 ch02-q016: unknown field "hints" (did you mean "hint"?)` |
| Keys match `^[a-z0-9][a-z0-9-]*$` and are unique within the course (questions and exercises together) | `duplicate key ch02-q014 (also in units/02-…/questions.yaml:12)` |
| `section` is one of the unit's section keys | `section "2.21" is not in unit 2` |
| single / output-choice: 2–6 distinct options; answer is one of them | `answer "zzz" is not among the options` |
| multi: ≥ 1 answer, all among the options | |
| typed / output-typed: non-empty `accept` | |
| order: ≥ 2 distinct items · match: 3–6 pairs, distinct definitions | |
| exercise: sections exist; ≥ 1 requirement; ≥ 1 test; test names unique | |
| unit numbers unique; every unit folder's number appears in the outline | `unit folder 07-… has number 7, which is not in course.yaml outline` |
| section keys unique within a unit | |
| notes: every section has a heading starting with its key (`## 2.7 …`); every `note_anchor` names a heading | `notes.md has no heading for section 2.20` |
| difficulty in {1, 2, 3} | |

Errors carry a line number when the YAML node has one (a small loader keeps PyYAML's node marks). Validation collects all errors instead of stopping at the first.

## Project structure

```
server/src/recall_content/
  __init__.py       parse_course(path) -> ParsedCourse | raises ContentErrors
  schemas.py        Pydantic models
  loader.py         YAML with line marks; folder walking
  rules.py          cross-field and cross-file rules
  notes.py          heading extraction (same ids as the web app: "s2.7", slugs)
  hashing.py        canonical JSON + SHA-256
server/tests/content/
  fixtures/valid-course/  fixtures/broken/<rule>/
  test_schemas.py  test_rules.py  test_loader.py  test_tlpi.py
```

## Code style

```python
def check_answer_in_options(q: Single | OutputChoice, where: Where) -> list[ContentError]:
    if q.answer in q.options:
        return []
    return [where.error(f'answer "{q.answer}" is not among the options')]
```

One rule per function, each returning a list of errors (never raising), so the validator can report everything at once.

## Testing strategy

- pytest in `server/tests/content/`.
- A known-good fixture course passes with zero errors.
- One broken fixture per rule, asserting the exact message, file and line.
- `test_tlpi.py`: the real `courses/tlpi/` (produced by `content-import`'s conversion) parses with zero errors and 50 questions. Skipped until that folder exists.
- Round trip: parse → dump to YAML → parse gives equal models and equal hashes.

## Boundaries

- **Always:** reject unknown fields; report all errors; keep notes Markdown byte-for-byte.
- **Ask first:** changing the file layout or any field name once TLPI is converted (it's the authoring contract); adding a dependency beyond pydantic and pyyaml.
- **Never:** touch the database here; silently fix or drop invalid content; execute anything found in content files.

## Success criteria

1. `parse_course("courses/tlpi")` returns 1 content unit (chapter 2), 19 sections, 50 questions, 64 outline entries, and no errors.
2. Every rule in the table has a failing fixture with an exact, readable message including file and line.
3. The same content always gives the same hashes (stable across runs and machines).
4. pyright passes; coverage ≥ 95% for `recall_content`.

## Open questions

- None.
