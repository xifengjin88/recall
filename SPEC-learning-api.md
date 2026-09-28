# Spec: learning-api

Module of [SPEC.md](SPEC.md). Depends on: `sm2-engine`, `store`, `catalog-api`.

## Objective

Everything about the learner's progress, served by Flask with the server as the source of truth for scheduling. The browser reports what happened (a rating, a session finished, a test ticked); the server applies `recall_engine`, stores the result and returns it. All progress is per course (SPEC.md); one default learner until auth exists.

## Shapes

The wire format matches the web app's `ProgressData` v2 (`web/app/lib/progress.ts`), so the store can load it unchanged: camelCase, times in epoch ms, cards keyed by item key.

- `Card`: `{id, kind, phase, step, due, interval, ease, reps, lapses, lastReview, lastRating, leech, suspended, updatedAt}`
- `Review`: `{id, cardId, kind, source, sessionId, at, rating, correct, answer, hinted, overridden, before, after, durationMs?, meta?}`. `before`/`after` are full cards (a superset of the client's `CardSnapshot`), so an override can re-rate from the exact pre-review state.
- `Previews`: `{again: Card, hard: Card, good: Card, easy: Card}`

## Endpoints

All paths are under `/api/courses/<slug>` unless noted. Unknown course → 404 `course_not_found`; unknown item key → 404 `item_not_found`; invalid bodies → 400 `invalid_request` with Pydantic field details.

| Method + path | Body → response |
|---|---|
| `GET /progress` | → `ProgressData` for this course: cards, reviews, sessions, exercises, settings (theme, key hints, this course's scheduling overrides), prefs, lastChapter |
| `PUT /progress` | `{mode: "replace" \| "merge", file}` where `file` is an export (v2, or the old v1 box format, converted like `migrateV1`) → `{progress: ProgressData, skipped}`. Merge keeps the newer record per item and the current settings. Records whose item keys aren't in the course are skipped and counted |
| `GET /progress/export` | → export file `{app, subject, version: 2, exportedAt, data}` |
| `DELETE /progress` | `?unit=N` resets one unit's items, otherwise everything (settings kept) → `ProgressData` |
| `POST /reviews` | `{id, itemKey, source, sessionId, rating, correct, answer, hinted?, durationMs?, meta?}` → `{review, card}`. The server loads (or creates) the card, applies `answer()` with the learner's clock and the resolved preset, and stores card + review in one transaction. **Idempotent by `id`**: a repeated id returns the stored result unchanged |
| `POST /reviews/<id>/override` | → `{review, card}`: re-rates the review as Hard / correct / overridden from its `before` card |
| `GET /cards/<key>/preview` | → `Previews` for the card as it stands now |
| `PATCH /cards/<key>` | `{suspended}` → `Card` |
| `POST /sessions` | `{id, mode}` → session (idempotent by id) |
| `POST /sessions/<id>/complete` | → session with `completedAt` and `completedDay` (the learner's study day) |
| `PATCH /exercises/<key>` | partial `ExerciseState` → `ExerciseState` (first touch moves it to in progress) |
| `POST /exercises/<key>/attempts` | `{mode: "redo" \| "quick"}` → `ExerciseState` (tests and hints reset, notes kept) |
| `GET /queue` | `?kind=question\|exercise&learnAhead=0\|1` → `{learning, review, fresh}` item keys from `today_queue` over the course's active items in book order |
| `GET /today` | → `{learning, review, fresh, redo: [keys], nextDue: ms \| null}` for the course home |
| `GET /scheduling` | → `{defaults: {question, exercise}, overrides, effective}` (engine defaults + course defaults, learner overrides, their combination) |
| `PATCH /scheduling` | `{kind, changes: {...} \| null}` → same as GET. Values are validated with Anki's ranges; `null` resets that kind |
| `PUT /last-unit` | `{number}` → 204 |
| `GET /api/settings` · `PATCH /api/settings` | `{theme, showKeyHints, timeZone, prefs}`; `timeZone` must be a valid IANA zone |

`GET /api/courses` (catalog) gains `today: {learning, review, fresh}` per course for the grid.

## Code layout

```
server/src/recall_api/
  schemas/progress.py      Pydantic request/response models (camelCase aliases)
  services/progress.py     load, export, import (v1/v2), reset
  services/reviews.py      apply rating, override, preview (recall_engine at the boundary)
  services/queue.py        today queue, today counts, course grid counts
  services/settings.py     learner settings, scheduling overrides (validated)
  services/cards.py        Card rows <-> recall_engine.Card
  api/progress.py  api/reviews.py  api/settings.py   blueprints
migrations/versions/0002_progress.py
tests/api/test_progress_io.py  test_reviews.py  test_exercises.py  test_settings.py  test_queue.py
```

## Testing strategy

- pytest against `recall_test` in rolled-back transactions, through the Flask test client.
- Reviews: results equal `recall_engine.answer` for the stored clock and preset; posting the same id twice changes nothing; override matches the TS behaviour; learning cards come back due in minutes.
- Import/export: an export from today's web app (v2) round-trips; the v1 fixture from the web tests converts to the same cards and reviews as the TS `migrateV1`.
- Queue and today counts: limits, per-course overrides and the learner's 04:00 boundary in a non-UTC zone.
- API samples are added to `web/app/api/samples` for the web contract check.

## Boundaries

- **Always:** schedule only on the server; validate every request body; keep everything per learner and per course.
- **Ask first:** changing a response shape the web app uses; adding endpoints that write outside one course.
- **Never:** trust client-computed card states; delete reviews except through an explicit reset.

## Success criteria

1. A quiz answer posted to `/reviews` produces the same card the Python engine computes, and a retry with the same id is a no-op.
2. An exported progress file from the current app imports via `PUT /progress` and exports back equal (reviews, cards, exercises, settings).
3. Changing new cards/day for one course changes only that course's queue.
4. Every endpoint has tests, including its error cases.
