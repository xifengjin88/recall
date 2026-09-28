# Recall

Spaced-repetition study app: quizzes, flashcards and hands-on exercises, scheduled by an Anki-style (SM-2) engine. Its first course is *The Linux Programming Interface*.

The repo is a monorepo with two projects that run as separate processes:

| Folder | What | Stack |
|---|---|---|
| `web/` | The study app | React 19, React Router 8 (SPA), Tailwind 4, shadcn/ui, Vitest |
| `server/` | Scheduling engine, course content, API | Python 3.13, Flask, SQLAlchemy 2, Pydantic 2, PostgreSQL 17 |
| `courses/` | Course content (YAML + Markdown), imported into Postgres | |

Specs: product behaviour in [`docs/SPEC.md`](docs/SPEC.md); engineering in [`SPEC.md`](SPEC.md) and `SPEC-*.md`; the current plan in [`tasks/`](tasks/).

## Getting started

Needs Docker, [uv](https://docs.astral.sh/uv/) and Node 20+.

```sh
make setup        # uv sync, npm ci, .env from .env.example, start Postgres
make dev-server   # API on http://localhost:5001
make dev-web      # app on http://localhost:5173 (proxies /api to the API)
```

## Commands

```sh
make db           # start Postgres (waits until healthy)
make db-reset     # wipe the database and start fresh
make test         # server (pytest) + web (vitest) tests
make lint         # ruff, pyright, tsc
make security     # npm audit + signatures, pip-audit, OSV.dev CVE lookups
```

Run `make` with no target to list them all.

## Adding content

Course content moves from `web/app/content/` into `courses/<slug>/` during the current milestone (see `SPEC-content-model.md`). Question and exercise keys are permanent: never renumber them; remove an item by deleting or retiring it and its history is kept.

## Deploy

Local only for now. `web/Dockerfile` builds the static SPA.
