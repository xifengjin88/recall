# Spec: catalog-api

Module of [SPEC.md](SPEC.md). Depends on: `store`.

## Objective

Read-only Flask endpoints that give the web app the list of courses and each course's outline, content and notes. Responses use the shapes the web app already works with (`Chapter`, `Question`, `Exercise` in `web/app/lib/types.ts`), so the web switch changes where content comes from, not how it is used.

## Endpoints

| Method + path | Response |
|---|---|
| `GET /api/health` | `{"ok": true}` |
| `GET /api/courses` | `{"courses": [{slug, title, short, author, description, unitCount, questionCount, exerciseCount}]}`, sorted by title. Study counts are added by `learning-api` (T24) |
| `GET /api/courses/<slug>` | `{slug, title, short, author, description, contentHash, outline: [{number, title, hasContent, hasNotes}]}` |
| `GET /api/courses/<slug>/content` | `{slug, contentHash, chapters: [Chapter]}` for units with content. A `Chapter` is `{number, title, note, sections: [{id, title}], questions: [...], exercises: [...]}`; items carry `id` (= key) and camelCase fields; retired items are included with `retired: true` so history stays readable. Sends `ETag: "<contentHash>"`; answers `If-None-Match` with 304 |
| `GET /api/courses/<slug>/units/<n>/notes` | `{number, markdown}` |

Errors are JSON with a 4xx status:

```json
{"error": {"code": "course_not_found", "message": "No course with slug \"nope\"."}}
```

Codes: `course_not_found`, `unit_not_found`, `notes_not_found`, `not_found` (unknown path), `method_not_allowed`, `internal_error` (500, no details leaked).

## Code layout

```
server/src/recall_api/
  app.py            create_app(config=None): config, db session per request, blueprints, error handlers
  errors.py         ApiError + JSON error handlers
  api/catalog.py    blueprint "catalog"
  services/catalog.py  queries returning Pydantic response models
  schemas/catalog.py   response models (camelCase aliases)
server/tests/api/test_catalog.py
```

## Testing strategy

- Flask test client against `recall_test`, each test in a rolled-back transaction, with the fixture course and TLPI imported through `services/content.py`.
- Contract test: `/content` for TLPI equals the web app's current `CHAPTERS` export (the JSON from T11's export script, stored as a fixture) field for field, so the web app can swap sources without other changes.
- 304 on matching `If-None-Match`; 404 shapes for unknown course, unit and notes.

## Boundaries

- **Always:** return the documented shapes; never expose database ids.
- **Ask first:** changing a response shape the web app uses.
- **Never:** write to the database from these endpoints; leak stack traces in errors.

## Success criteria

1. `/api/courses/tlpi/content` equals the web app's bundled content for chapter 2 (contract test).
2. A repeat request with `If-None-Match` returns 304 with no body.
3. Unknown course, unit or notes return 404 with the documented error shape.
