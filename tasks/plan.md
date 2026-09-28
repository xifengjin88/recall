# Implementation Plan: Recall backend (Milestone 1)

Specs: [SPEC.md](../SPEC.md) (capability map) · [SPEC-platform.md](../SPEC-platform.md) · [SPEC-sm2-engine.md](../SPEC-sm2-engine.md) · [SPEC-content-model.md](../SPEC-content-model.md) · product spec [docs/SPEC.md](../docs/SPEC.md). Task list: [todo.md](todo.md).

## Overview

Split the repo into `web/` and `server/`, build a pure Python SM-2 engine that reproduces the TypeScript one exactly, move course content into PostgreSQL through a file-based importer, serve it and the learner's progress from a Flask API where the server does all scheduling, and switch the React app over to it. Milestone 1 is done when TLPI runs entirely from Postgres and the app behaves as it does today, reached through a course grid at `/`.

## Architecture decisions

- **Server owns scheduling.** The browser sends rating events; the server runs SM-2 and returns the card and button previews. The TS engine is deleted at the end, after the Python engine passes every golden case generated from it.
- **Store UTC, use the learner's zone only for day boundaries** (review due dates, daily limits, streaks). See SPEC-sm2-engine §Time handling.
- **Keep the web app's internal interfaces, swap what's behind them.** `~/content` keeps its exports (`CHAPTERS`, `getChapter`, `QUESTIONS_BY_ID`, …) but is filled from the API by the course route's `clientLoader`; `progress-store` keeps its hooks and action names but calls the API. This keeps each web task to a handful of files even though 14 files import `~/content` and 15 use the store.
- **Content before progress.** The first vertical slice serves TLPI content from Postgres while progress still lives in IndexedDB. That proves the content path end to end before the riskier progress switch, and gives a working app at every checkpoint.
- **Parity through golden files, not review.** A vitest-driven generator writes JSON cases from the TS engine; pytest replays them exactly.
- **Specs stay gated.** `store`, `content-import`, `catalog-api`, `learning-api` and `web-client` get their `SPEC-<id>.md` written and approved at the checkpoints before their tasks start, per SPEC.md.

## Dependency graph

```
platform (T1–T3)
 ├── sm2-engine (T4–T7) ─────────────────────────────┐
 └── content-model (T8–T11)                           │
        └── store: content tables (T12)               │
              ├── content-import (T13)                │
              └── catalog-api (T14)                   │
                    └── web: course grid + /c/:course, content from API (T15–T17)
                          │
        store: progress tables (T18) ◄────────────────┘
              └── learning-api: progress import/export (T19)
                    └── learning-api: review events + sessions (T20)
                          └── web: quiz + flashcards on the server (T21)
                                ├── exercises on the server (T22)
                                ├── settings + scheduling overrides (T23)
                                └── today's queue + course counts (T24)
                                      └── one-time upload, retire TS engine + IndexedDB (T25)
```

Parallel-safe: T4–T7 (engine) alongside T8–T11 (content model). Everything from T12 on is sequential because it shares the schema and API contract.

## Task list

### Phase 1: Platform
- [x] T1 Move the web app into `web/`
- [x] T2 Python project skeleton in `server/`
- [x] T3 Postgres in Compose, Makefile, env, docs

**Checkpoint A:** `make test lint security` green; web app unchanged at `make dev-web`; `psql` reaches both databases.

### Phase 2: Engine (highest risk, first)
- [x] T4 Golden-case generator from the TS engine
- [x] T5 Engine foundations: types, clock, JS-compatible maths, steps
- [x] T6 `answer` and `preview` with golden parity
- [x] T7 Queue functions, purity, coverage, performance

### Phase 3: Content model (parallel with Phase 2)
- [ ] T8 Content schemas and hashing
- [ ] T9 Folder loader with line numbers and content rules
- [ ] T10 Notes heading rules
- [ ] T11 Convert TLPI into `courses/tlpi/`

**Checkpoint B:** golden parity 100%, engine coverage 100%, `courses/tlpi` validates clean. **Write and approve SPEC-store, SPEC-content-import, SPEC-catalog-api.**

### Phase 4: First vertical slice, content from Postgres
- [ ] T12 Content tables, models, first migration
- [ ] T13 `recall content validate / import / export` CLI
- [ ] T14 Catalog API (courses, outline, content, notes)
- [ ] T15 Web: API client, generated types, Vite proxy check
- [ ] T16 Web: course grid at `/` and `/c/:course` layout loading content
- [ ] T17 Web: course-scoped links and notes from the API

**Checkpoint C (half milestone):** open the grid, enter TLPI, take a quiz; content comes from Postgres, progress still in IndexedDB. **Write and approve SPEC-learning-api, SPEC-web-client.**

### Phase 5: Progress on the server
- [ ] T18 Progress tables and migration
- [ ] T19 Progress import / export / load endpoints
- [ ] T20 Review events and sessions endpoints (server runs SM-2)
- [ ] T21 Web: quiz and flashcards send rating events
- [ ] T22 Exercises on the server (attempts, rating, skip)
- [ ] T23 Settings and per-course scheduling overrides
- [ ] T24 Today's queue and course card counts from the server
- [ ] T25 One-time IndexedDB upload; retire the TS engine and IndexedDB

**Checkpoint D (Milestone 1):** all docs/SPEC.md acceptance criteria re-checked by hand on TLPI; a second tiny course imports and keeps separate state; `make test lint security` green.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Python engine drifts from TS (rounding, 32-bit maths, UTF-16, DST) | High: wrong due dates, silent | Golden cases incl. random chains and DST; named trap tests; fixtures regenerated only from TS, never edited |
| Web refactor sprawls across 14+ files | Med | Keep `~/content` and store interfaces; route files move under `/c/:course` with minimal edits; links through one helper |
| Losing current IndexedDB progress | High for you | T19 import endpoint first; T25 uploads automatically and keeps the local copy; manual export from Settings before T25 |
| Time zone missing or wrong | Med | Browser sends its zone on first load (T23); server default `UTC` until then; tests in a non-UTC zone |
| Lost updates when two tabs answer | Low (single learner) | Review events are idempotent by id and applied in order in one transaction (T20) |
| Generated TS types need a new npm dev dependency | Low | Ask in T15; fallback is hand-written types checked by a contract test |
| Postgres test isolation / flakiness | Med | Separate `recall_test` DB; each test in a rolled-back transaction; `make db` waits for healthcheck |

## Open questions (need your input)

1. Approve SPEC.md, SPEC-platform, SPEC-sm2-engine, SPEC-content-model (gate for T1–T11).
2. Rename the repo folder `tlpi-drill` → `recall` (best done in T1)?
3. Course slug `tlpi` or `linux-programming-interface` (fixed in T11)?
4. Streak per course (assumed) or across courses?
5. New dev dependencies: `coverage`, `pip-audit` (T2); `json-schema-to-typescript` for generated web types (T15).
