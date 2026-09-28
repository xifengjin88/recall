# Tasks: Recall backend (Milestone 1)

Plan: [plan.md](plan.md). Specs: [SPEC.md](../SPEC.md). Sizes: S = 1–2 files, M = 3–5 files.

---

## Phase 1: Platform  ·  module `platform`

## Task 1: Move the web app into `web/`

**Description:** `git mv` the React app (app/, public/, scripts/, package files, configs, Dockerfile, nginx.conf) into `web/`, reinstall node_modules there, and add the `/api` → `http://localhost:5001` proxy to `web/vite.config.ts`. Root keeps docs/, specs, CLAUDE.md, README.md.

**Acceptance criteria:**
- [x] `cd web && npm test` passes all 54 tests; `npm run typecheck` and `npm run build` pass
- [x] `git log --follow web/app/lib/engine/sm2.ts` shows the file's history
- [x] App at `npm run dev` looks and behaves as before

**Verification:**
- [x] `cd web && npm ci && npm test && npm run typecheck && npm run build`
- [x] Manual: open the dev server, take one quiz question

**Dependencies:** None · **Files:** web/vite.config.ts, web/package.json (paths only), moved tree · **Size:** M

## Task 2: Python project skeleton in `server/`

**Description:** uv project pinned to Python 3.13 with packages `recall_engine`, `recall_content`, `recall_api` (empty), dev tools ruff, pyright, pytest, coverage, pip-audit, a smoke test, and `scripts/osv_check.py` for uv.lock.

**Acceptance criteria:**
- [x] `uv run pytest` passes (smoke test imports all three packages)
- [x] `uv run ruff check . && uv run ruff format --check . && uv run pyright` pass
- [x] pip-audit and OSV check report 0 vulnerabilities

**Verification:**
- [x] `cd server && uv sync && uv run pytest && uv run pyright`

**Dependencies:** None (parallel with T1) · **Files:** server/pyproject.toml, server/src/*/__init__.py, server/tests/test_smoke.py, server/scripts/osv_check.py · **Size:** M

## Task 3: Postgres in Compose, Makefile, env, docs

**Description:** `compose.yaml` with `postgres:17-alpine`, healthcheck, named volume and an init script creating `recall_test`; root `Makefile` with the targets in SPEC-platform; `.env.example`; README and AGENTS.md updated for the monorepo.

**Acceptance criteria:**
- [x] `make db` returns only after Postgres is healthy; both DATABASE_URLs connect
- [x] `make test`, `make lint`, `make security` run both projects and pass
- [x] README "Getting started" works from a fresh clone

**Verification:**
- [x] `make db-reset && psql "postgresql://recall:recall@localhost:5432/recall_test" -c 'select 1'`
- [x] `make test lint security`

**Dependencies:** T1, T2 · **Files:** compose.yaml, docker/initdb.sql, Makefile, .env.example, README.md, AGENTS.md · **Size:** M

### Checkpoint A: Platform
- [x] `make test lint security` green
- [x] Web app unchanged under `make dev-web`
- [ ] Review with human before Phase 2/3

---

## Phase 2: Engine  ·  module `sm2-engine`

## Task 4: Golden-case generator from the TS engine

**Description:** A vitest file in `web/scripts/` that, when `GEN_GOLDEN=1`, runs the TS engine over the scenario matrix in SPEC-sm2-engine (phases × ratings × presets, late/early, rollover, both 2026 DST changes in America/New_York, 200 random chains × 30 steps, queue cases) and writes `server/tests/engine/golden/sm2.json`; without the flag it checks the file is still what the TS engine produces.

**Acceptance criteria:**
- [x] `sm2.json` has ≥ 5,000 recorded steps and records its time zone
- [x] Re-running the generator produces a byte-identical file (deterministic)
- [x] Normal `npm test` includes the "golden file is current" check

**Verification:**
- [x] `cd web && TZ=America/New_York GEN_GOLDEN=1 npx vitest run scripts/gen-engine-golden.test.ts` then `git diff --stat` shows no change on a second run

**Dependencies:** T1, T2 · **Files:** web/scripts/gen-engine-golden.test.ts, web/vitest.config.ts, server/tests/engine/golden/sm2.json · **Size:** S

## Task 5: Engine foundations

**Description:** `types.py`, `presets.py` (incl. `resolve_preset` layers), `clock.py` (StudyClock, study_day, day_start_ms, add_days with zoneinfo), `rng.py` (JS-compatible mulberry32 + FNV-1a over UTF-16), `jsmath.py` (js_round), `steps.py`.

**Acceptance criteria:**
- [x] Trap tests pass: `js_round(2.5)==3`, `js_round(-2.5)==-2`, RNG/hash sequences equal TS values, UTF-16 hashing, 23/25-hour DST days
- [x] Study-day and 04:00 rollover tests pass in America/Los_Angeles
- [x] pyright strict passes on `recall_engine`

**Verification:**
- [x] `cd server && uv run pytest tests/engine/test_traps.py tests/engine/test_clock.py && uv run pyright src/recall_engine`

**Dependencies:** T4 (trap expectations come from TS) · **Files:** src/recall_engine/{types,presets,clock,rng,jsmath,steps}.py, tests/engine/{test_traps,test_clock}.py · **Size:** M

## Task 6: `answer` and `preview` with golden parity

**Description:** Port `sm2.ts` (learn, relearn, review incl. late/early rules, fuzz, lapses, leech, clamping) and `preview`; port the 19 behaviour tests; replay every golden step.

**Acceptance criteria:**
- [x] 100% of golden steps match field-for-field (due to the millisecond)
- [x] All ported behaviour tests pass
- [x] A deliberately wrong rounding makes the golden test fail (checked once, reverted)

**Verification:**
- [x] `uv run pytest tests/engine/test_sm2.py tests/engine/test_golden.py -q`

**Dependencies:** T5 · **Files:** src/recall_engine/sm2.py, src/recall_engine/__init__.py, tests/engine/test_sm2.py, tests/engine/test_golden.py · **Size:** M

## Task 7: Queue functions, purity, coverage, performance

**Description:** `queue.py` (is_due, is_mastered, done_today, today_queue) with golden queue cases; purity test (stdlib only); coverage at 100%; perf test for 10,000 cards.

**Acceptance criteria:**
- [x] Queue golden cases match; purity test passes
- [x] `coverage` reports 100% lines and branches for `recall_engine`
- [x] `today_queue` over 10,000 cards < 50 ms

**Verification:**
- [x] `uv run coverage run -m pytest tests/engine && uv run coverage report --fail-under=100 --include='src/recall_engine/*'`

**Dependencies:** T6 · **Files:** src/recall_engine/queue.py, tests/engine/{test_queue,test_purity,test_perf}.py · **Size:** M

---

## Phase 3: Content model  ·  module `content-model` (parallel with Phase 2)

## Task 8: Content schemas and hashing

**Description:** Pydantic models for course meta, outline, unit, sections, the question union (incl. the two `output` shapes) and exercises; camelCase aliases; `extra="forbid"`; canonical-JSON SHA-256 per item and per course.

**Acceptance criteria:**
- [x] Every question type parses from a valid dict and rejects an unknown field
- [x] `output` with both or neither shape is rejected with a clear message
- [x] Hash is identical across runs and key order

**Verification:**
- [x] `uv run pytest tests/content/test_schemas.py && uv run pyright src/recall_content`

**Dependencies:** T2 · **Files:** src/recall_content/{schemas,hashing}.py, tests/content/test_schemas.py · **Size:** S

## Task 9: Folder loader with line numbers and content rules

**Description:** YAML loading that keeps node line marks, course folder walking, and the rule set from SPEC-content-model (keys, sections, options/answers, accept, order, match, exercises, outline/unit numbers), collecting all errors.

**Acceptance criteria:**
- [x] Valid fixture course → 0 errors
- [x] One broken fixture per rule → exact message with file and line
- [x] Parse → dump → parse gives equal models and hashes

**Verification:**
- [x] `uv run pytest tests/content/test_loader.py tests/content/test_rules.py`

**Dependencies:** T8 · **Files:** src/recall_content/{loader,rules,__init__}.py, tests/content/{test_loader,test_rules}.py, tests/content/fixtures/ · **Size:** M

## Task 10: Notes heading rules

**Description:** Port `headingId` / section extraction (ids like `s2.7`, slugs, `#` inside code fences ignored) and the rules "every section has a heading" and "every note_anchor exists".

**Acceptance criteria:**
- [x] Heading ids equal the web app's for the same inputs (shared cases)
- [x] Missing section heading and bad anchor each produce the documented error

**Verification:**
- [x] `uv run pytest tests/content/test_notes.py`

**Dependencies:** T9 · **Files:** src/recall_content/notes.py, src/recall_content/rules.py, tests/content/test_notes.py · **Size:** S

## Task 11: Convert TLPI into `courses/tlpi/`

**Description:** One-off script (vitest-run in web/) that writes `courses/tlpi/course.yaml` (64-entry outline), `units/02-fundamental-concepts/{unit.yaml,questions.yaml,notes.md}` from the current `ch02.ts`, `toc.ts`, `subject.ts` and `notes/ch02.md`.

**Acceptance criteria:**
- [x] `parse_course("courses/tlpi")` → 0 errors, 1 content unit, 19 sections, 50 questions, 64 outline entries
- [x] Every question's fields match the TS source (script asserts equality on read-back)
- [x] `notes.md` is byte-identical to `app/content/notes/ch02.md`

**Verification:**
- [x] `uv run pytest tests/content/test_tlpi.py` · `cmp web/app/content/notes/ch02.md courses/tlpi/units/02-fundamental-concepts/notes.md`

**Dependencies:** T1, T9, T10 · **Files:** web/scripts/export-course.test.ts, courses/tlpi/**, tests/content/test_tlpi.py · **Size:** M

### Checkpoint B: Engine + content model
- [x] Golden parity 100%; engine coverage 100%; `courses/tlpi` validates clean
- [x] `make test lint security` green
- [x] **Write and approve SPEC-store, SPEC-content-import, SPEC-catalog-api** before Phase 4

---

## Phase 4: Content from Postgres (first vertical slice)  ·  `store`, `content-import`, `catalog-api`, `web-client`

## Task 12: Content tables, models, first migration

**Description:** SQLAlchemy 2.0 models for learners (with default row), courses, units, sections, notes, items (jsonb body, content_hash, retired), import_runs; `db.py` engine/session; Alembic initial migration; pytest fixture with per-test rolled-back transaction on `recall_test`.

**Acceptance criteria:**
- [x] `alembic upgrade head` on an empty DB creates all tables and the default learner; `downgrade base` removes them
- [x] Unique `(course_id, key)` and FK constraints enforced (tested)

**Verification:**
- [x] `make db-reset && cd server && uv run alembic upgrade head && uv run pytest tests/store`

**Dependencies:** Checkpoint B · **Files:** src/recall_api/{db,models}.py, migrations/versions/0001_content.py, tests/conftest.py, tests/store/test_models.py · **Size:** M

## Task 13: `recall content validate / import / export` CLI

**Description:** Import `ParsedCourse` in one transaction: upsert course/units/sections/notes/items by key, skip unchanged hashes, retire missing items, record import_run; `--dry-run`; export back to files.

**Acceptance criteria:**
- [x] First import of TLPI: "added 50"; second: "unchanged 50", zero writes to items
- [x] Removing a question from the file retires it (row kept); restoring un-retires
- [x] Invalid course → errors printed, nothing written, exit code 1

**Verification:**
- [x] `uv run recall content import ../courses/tlpi && uv run recall content import ../courses/tlpi` · `uv run pytest tests/content_import`

**Dependencies:** T12 · **Files:** src/recall_api/services/content.py, src/recall_api/cli.py, tests/content_import/test_import.py · **Size:** M

## Task 14: Catalog API

**Description:** Flask app factory, JSON error format, `GET /api/courses`, `/api/courses/<slug>` (outline incl. empty units), `/content` (ETag = last import id, 304 support), `/units/<n>/notes`.

**Acceptance criteria:**
- [x] Responses match the camelCase shapes the web app's `Chapter`/`Question`/`Exercise` types expect (contract test against a fixture)
- [x] Second `/content` request with `If-None-Match` returns 304
- [x] Unknown course/unit → 404 in the documented error shape

**Verification:**
- [x] `uv run pytest tests/api/test_catalog.py` · `curl -i localhost:5001/api/courses`

**Dependencies:** T13 · **Files:** src/recall_api/{app,errors}.py, src/recall_api/api/catalog.py, tests/api/test_catalog.py · **Size:** M

## Task 15: Web API client and types

**Description:** Typed fetch client (`web/app/api/client.ts`) with the error shape; hand-written response types (`web/app/api/types.ts`) checked by `contract.ts` against real responses saved by `server/tests/api/test_samples.py` (no generator dependency).

**Acceptance criteria:**
- [x] `tsc` fails if a server field is renamed (proven once)
- [x] Client surfaces API errors as typed errors

**Verification:**
- [x] `cd server && uv run pytest tests/api/test_samples.py && cd ../web && npm run typecheck && npm test`

**Dependencies:** T14 · **Files:** web/app/api/client.ts, web/app/api/types.gen.ts, server/scripts/export_schema.py, Makefile · **Size:** S

## Task 16: Course grid at `/` and `/c/:course` layout loading content

**Description:** New home: grid of course cards. Existing routes nest under `/c/:course`; its layout `clientLoader` fetches outline + content and fills the `~/content` facade (same exports as today). The bundled `app/content/ch02.ts` stops being used.

**Acceptance criteria:**
- [x] `/` shows a TLPI card; clicking it opens `/c/tlpi` with the current Home
- [x] Every existing screen works under `/c/tlpi/…` with content from the API
- [x] Unknown course slug → 404 page

**Verification:**
- [x] `cd web && npm test && npm run typecheck` · Manual: grid → course → chapter → quiz

**Dependencies:** T15 · **Files:** web/app/routes.ts, web/app/routes/courses.tsx, web/app/routes/course.tsx, web/app/content/index.ts · **Size:** M

## Task 17: Course-scoped links and notes from the API

**Description:** A `useCoursePath()` helper; replace hard-coded `/chapters…`, `/session…`, `/exercises…`, `/stats` links; notes page and side panel fetch `/units/<n>/notes`.

**Acceptance criteria:**
- [ ] No link in the app leaves the current course by accident (grep for `to="/` finds only the grid and settings)
- [ ] Notes page and "See in notes" panel render from the API

**Verification:**
- [ ] `cd web && npm test && npm run typecheck` · Manual: every nav link and note link under `/c/tlpi`

**Dependencies:** T16 · **Files:** web/app/lib/paths.ts + link call sites (split into two commits if > 5 files) · **Size:** M

### Checkpoint C: Content from Postgres (half milestone)
- [ ] Grid → TLPI → quiz works; content from Postgres; progress still in IndexedDB
- [ ] `make test lint security` green
- [ ] **Write and approve SPEC-learning-api, SPEC-web-client** before Phase 5

---

## Phase 5: Progress on the server  ·  `store`, `learning-api`, `web-client`

## Task 18: Progress tables and migration

**Description:** Models + migration for cards, reviews, sessions, exercise_states, learner_settings (theme, key hints, prefs, time zone), course_settings (scheduling overrides), all scoped by learner and course, with the indexes from the architecture doc.

**Acceptance criteria:**
- [ ] Migration up/down clean on a DB that already has content
- [ ] Constraints: one card per (learner, item); review ids unique; rating/phase enums enforced

**Verification:**
- [ ] `uv run alembic upgrade head && uv run pytest tests/store`

**Dependencies:** Checkpoint C · **Files:** src/recall_api/models.py, migrations/versions/0002_progress.py, tests/store/test_progress_models.py · **Size:** S

## Task 19: Progress load / import / export endpoints

**Description:** `GET /api/courses/<slug>/progress`, `PUT …/progress` (replace or merge; accepts current v2 and old v1 export files), `GET …/progress/export`.

**Acceptance criteria:**
- [ ] A Settings › Export file from today's app round-trips PUT → GET unchanged
- [ ] v1 box-format file imports with the same results as the TS `migrateV1` (shared fixture)
- [ ] Merge keeps the newer record per item

**Verification:**
- [ ] `uv run pytest tests/api/test_progress_io.py`

**Dependencies:** T18 · **Files:** src/recall_api/schemas/progress.py, src/recall_api/services/progress.py, src/recall_api/api/progress.py, tests/api/test_progress_io.py · **Size:** M

## Task 20: Review events and sessions (server runs SM-2)

**Description:** `POST …/reviews` (applies `recall_engine.answer`, stores card + review in one transaction, returns card + previews), `POST …/reviews/<id>/override`, session start/complete endpoints.

**Acceptance criteria:**
- [ ] Posting the same review id twice changes nothing the second time
- [ ] Results equal `recall_engine.answer` for the learner's clock and resolved preset
- [ ] Override re-rates from the pre-review card, as today

**Verification:**
- [ ] `uv run pytest tests/api/test_reviews.py`

**Dependencies:** T19, T7 · **Files:** src/recall_api/services/reviews.py, src/recall_api/api/reviews.py, tests/api/test_reviews.py · **Size:** M

## Task 21: Web: quiz and flashcards send rating events

**Description:** `progress-store` loads progress from the API and implements `recordReview` / `overrideReview` / sessions by calling T20, using the returned card; flashcard button labels come from returned previews.

**Acceptance criteria:**
- [ ] A quiz answer appears in `reviews` and `cards` in Postgres; reload shows the same state
- [ ] Wrong answers still come back within the session; labels still show `1m · 6m · 10m · 4d`
- [ ] API failure shows the "Couldn't save" notice

**Verification:**
- [ ] `cd web && npm test` · Manual: quiz + flashcards, then `psql -c 'select count(*) from reviews'`

**Dependencies:** T20 · **Files:** web/app/state/progress-store.ts, web/app/state/api-repo.ts, web/app/routes/session.tsx, web/app/state/progress-store.test.ts · **Size:** M

## Task 22: Exercises on the server

**Description:** Endpoints for exercise state (tests ticked, hints, notes, attempt start, skip/unskip) and rating through the review endpoint; web exercise page switched over.

**Acceptance criteria:**
- [ ] Finishing and rating an exercise schedules a redo (test course with one exercise)
- [ ] Skip suspends the card; unskip restores it

**Verification:**
- [ ] `uv run pytest tests/api/test_exercises.py` · Manual on the test course

**Dependencies:** T21 · **Files:** src/recall_api/api/exercises.py, src/recall_api/services/exercises.py, tests/api/test_exercises.py, web/app/components/exercise-review.tsx, web/app/state/progress-store.ts · **Size:** M

## Task 23: Settings and per-course scheduling overrides

**Description:** `GET/PATCH /api/settings` (theme, key hints, prefs, time zone sent by the browser on load) and per-course scheduling overrides validated with `resolve_preset`; Settings page wired to them.

**Acceptance criteria:**
- [ ] Changing "New cards/day" for TLPI affects only TLPI's next queue
- [ ] Invalid values rejected with the same messages as the UI validation
- [ ] Browser time zone stored on first load

**Verification:**
- [ ] `uv run pytest tests/api/test_settings.py` · Manual: Settings › Scheduling

**Dependencies:** T21 · **Files:** src/recall_api/api/settings.py, src/recall_api/services/settings.py, tests/api/test_settings.py, web/app/components/scheduling-settings.tsx, web/app/routes/settings.tsx · **Size:** M

## Task 24: Today's queue and course card counts from the server

**Description:** `GET …/queue?scope=today|due` (ids from `today_queue`) used by session setup; course grid and course Home counts (learning, due, new, redos) computed server-side.

**Acceptance criteria:**
- [ ] Counts on the grid, course Home and session setup agree with each other
- [ ] Daily limits respect per-course overrides and the learner's 04:00 boundary

**Verification:**
- [ ] `uv run pytest tests/api/test_queue.py` · Manual: counts before and after a session

**Dependencies:** T23 · **Files:** src/recall_api/services/queue.py, src/recall_api/api/queue.py, tests/api/test_queue.py, web/app/routes/course-home.tsx, web/app/components/session-setup.tsx · **Size:** M

## Task 25: One-time IndexedDB upload; retire the TS engine and IndexedDB

**Description:** On first load with the server empty for this learner and IndexedDB data present, upload it via T19 (merge) and show a notice; then delete `web/app/lib/engine`, `idb-repo.ts`, Dexie and fake-indexeddb, keeping `server/tests/engine/golden/sm2.json`; update docs/SPEC.md §6–7, README, CLAUDE.md.

**Acceptance criteria:**
- [ ] Your current browser progress appears on the server after first load; local copy kept
- [ ] No web code imports the removed engine; bundle no longer includes Dexie
- [ ] `make test lint security` green

**Verification:**
- [ ] Manual: export first, load app, compare counts with the export · `make test lint security`

**Dependencies:** T22, T23, T24 · **Files:** web/app/state/migrate-local.ts, web/app/routes/shell.tsx, web/package.json, docs/SPEC.md, README.md (+ deletions) · **Size:** M

### Checkpoint D: Milestone 1
- [ ] Every docs/SPEC.md acceptance criterion re-checked by hand on TLPI
- [ ] A second tiny course imports, appears on the grid, and keeps separate study state
- [ ] `make test lint security` green
- [ ] Review with human
