# Capability Map: Recall backend

Move Recall from a browser-only app to a web client + Python server with PostgreSQL, so it can hold many courses, each with its own study state. The first milestone ports the existing TLPI course with no loss of behaviour.

This file is the index of the engineering specs. The product spec (what the learner sees and does) stays in `docs/SPEC.md`.

## Decisions (2026-09-28)

| Topic | Decision |
|---|---|
| Repo | Monorepo: `web/` and `server/` are separate projects, run as separate processes |
| Database | PostgreSQL 17 in Docker Compose |
| Scheduling | Server is the source of truth: a pure Python SM-2 engine. The browser sends rating events; the TS engine is retired |
| Content | YAML (questions, exercises, outline) + Markdown (notes) files in `courses/`, imported into Postgres by a CLI. No upload UI yet |
| Courses | Home is a grid of course cards. Study state is per course: no cross-course sessions, queues, limits or settings |
| Auth | None yet. One default learner row |
| Time | Store and send UTC; the learner's time zone is used only for day boundaries (due dates, daily limits, streaks) |
| Milestone 1 | TLPI fully served from Postgres; the app behaves as it does today |

## Modules

| Module id | Responsibility | Depends on | Spec |
|---|---|---|---|
| `platform` | Monorepo layout, Python tooling, Postgres in Compose, shared commands, security checks | — | [SPEC-platform.md](SPEC-platform.md) |
| `sm2-engine` | Pure Python scheduler with golden-case parity to the TS engine; time-zone aware | `platform` | [SPEC-sm2-engine.md](SPEC-sm2-engine.md) |
| `content-model` | Pydantic content schemas, the YAML + Markdown file format, parser and content rules | `platform` | [SPEC-content-model.md](SPEC-content-model.md) |
| `store` | Postgres schema, SQLAlchemy models, Alembic migrations, sessions, default learner | `sm2-engine`, `content-model` | [SPEC-store.md](SPEC-store.md) |
| `content-import` | `recall content validate / import / export` CLI; TLPI conversion to files | `content-model`, `store` | [SPEC-content-import.md](SPEC-content-import.md) |
| `catalog-api` | Read-only course, outline, content and notes endpoints | `store` | [SPEC-catalog-api.md](SPEC-catalog-api.md) |
| `learning-api` | Review events (server runs SM-2), sessions, exercises, settings, progress import/export, course card counts | `sm2-engine`, `store`, `catalog-api` | [SPEC-learning-api.md](SPEC-learning-api.md) |
| `web-client` | React app on the API: course grid, `/c/:course` routes, rating events, retire TS engine and IndexedDB (after one-time upload) | `catalog-api`, `learning-api` | [SPEC-web-client.md](SPEC-web-client.md) |

Build order: `platform` → `sm2-engine`, `content-model` (parallel) → `store` → `content-import`, `catalog-api` → `learning-api` → `web-client`

## Cross-cutting conventions

- **Wire format:** JSON with camelCase keys (Pydantic aliases); Python code is snake_case. Timestamps are epoch milliseconds. Content is referred to by item key (`ch02-q014`), never by database id.
- **Per-course scope:** every progress record (card, review, session, exercise state, scheduling overrides) belongs to one learner and one course.
- **Time:** all timestamps are stored and sent as UTC (Postgres `timestamptz`, epoch ms on the wire) and shown in local time by the browser. The learner's IANA time zone, stored in settings, is used only to find day boundaries (a study day starts at 04:00 local): review due dates, daily limits and streaks. Details in [SPEC-sm2-engine.md](SPEC-sm2-engine.md#time-handling).
- **Dependencies:** adding any package needs approval and must pass the security checks (`make security`).

## Open questions

1. Rename the repo folder from `tlpi-drill` to `recall`?
2. Keep the course slug `tlpi`, or use `linux-programming-interface` in URLs and folders?
3. Streak: per course (consistent with per-course study state) or across all courses? Assumed per course.
