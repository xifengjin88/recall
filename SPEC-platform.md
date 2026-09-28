# Spec: platform

Module of [SPEC.md](SPEC.md). Depends on: nothing.

## Objective

Turn the current single-app folder into a monorepo where the web app and the Python server are separate projects that run as separate processes, share one PostgreSQL instance in Docker, and are driven by one set of top-level commands. Nothing about the web app's behaviour changes in this module.

Done means: a fresh checkout can start Postgres, the server and the web app with the documented commands; every existing web test still passes from `web/`; the server project lints, type-checks and runs an empty test suite; security checks pass for both.

## Tech stack

| Area | Choice |
|---|---|
| Python | 3.13 (installed and pinned by uv); `requires-python = ">=3.13,<3.14"` |
| Python tooling | uv (env + lockfile), ruff (lint + format), pyright (strict for `recall_engine`, standard elsewhere), pytest |
| Server runtime deps (added by later modules, listed here for approval) | flask 3, sqlalchemy 2, psycopg[binary] 3, pydantic 2, alembic, pyyaml |
| Database | `postgres:17-alpine` via Docker Compose |
| Web | unchanged: React 19, React Router 8, Vite 8, Tailwind 4, vitest |
| Task runner | GNU make (already on macOS) |

## Commands

```sh
make setup          # uv sync (server) + npm ci (web) + docker compose up -d db
make db             # docker compose up -d db     (waits for healthy)
make db-reset       # docker compose down -v && docker compose up -d db   (wipes data)
make dev-server     # cd server && uv run flask --app recall_api run --port 5001 --debug
make dev-web        # cd web && npm run dev       (Vite on :5173, proxies /api → :5001)
make test           # test-server + test-web
make test-server    # cd server && uv run pytest
make test-web       # cd web && npm test
make lint           # server: ruff check, ruff format --check, pyright · web: npm run typecheck
make security       # web: npm run security · server: uv run pip-audit + scripts/osv_check.py on uv.lock
```

Environment (copied from `.env.example` to `.env`, never committed):

```
DATABASE_URL=postgresql+psycopg://recall:recall@localhost:5432/recall
TEST_DATABASE_URL=postgresql+psycopg://recall:recall@localhost:5432/recall_test
```

## Project structure

```
./                       (repo root, currently tlpi-drill/)
  web/                   the existing React app, moved as-is
    app/  public/  scripts/  package.json  vite.config.ts  vitest.config.ts
    tsconfig.json  react-router.config.ts  components.json  Dockerfile  nginx.conf
  server/
    pyproject.toml  uv.lock
    src/recall_engine/   pure scheduler            (module sm2-engine)
    src/recall_content/  content schemas + parser   (module content-model)
    src/recall_api/      Flask app, models, CLI     (store, content-import, *-api)
    migrations/          Alembic
    tests/               mirrors src/: tests/engine, tests/content, tests/api …
    scripts/osv_check.py
  courses/               course content files (module content-model)
  docs/                  product spec (docs/SPEC.md), decision records
  compose.yaml           postgres + init script that also creates recall_test
  Makefile  .env.example  .gitignore
  SPEC.md  SPEC-*.md  AGENTS.md  CLAUDE.md  README.md
```

The web app keeps working on its own: `cd web && npm run dev` still runs it (with the API absent until `web-client`). The Vite dev server gets a `/api` proxy to `http://localhost:5001`.

## Code style

Python, shown on the kind of code later modules will write:

```python
from dataclasses import dataclass
from enum import StrEnum


class Rating(StrEnum):
    AGAIN = "again"
    HARD = "hard"
    GOOD = "good"
    EASY = "easy"


@dataclass(frozen=True, slots=True)
class StudyClock:
    """Where study days begin for one learner."""

    tz: str
    rollover_hour: int = 4
```

- snake_case functions and fields, PascalCase classes, UPPER_CASE constants.
- Type hints everywhere; pyright must pass. No `Any` in public signatures.
- Docstrings say why or what for, briefly; no restating the code.
- ruff defaults plus `I` (imports), `UP`, `B`, `SIM`; line length 110 (matches the web code's width).
- Web conventions are unchanged (see `CLAUDE.md`).

## Testing strategy

- This module adds no behaviour, so its tests are the existing ones in their new place: `make test-web` passes all current vitest suites (currently 54 tests) and `npm run build` and `npm run typecheck` pass from `web/`.
- `server/` starts with one smoke test (`import recall_engine`) so `make test-server` runs green from day one.
- Postgres readiness: `make db` waits on the Compose healthcheck (`pg_isready`), so tests never race the database.

## Boundaries

- **Always:** keep the web app's behaviour identical; move files with their history intact; run `make lint test security` before calling the module done; keep secrets in `.env`.
- **Ask first:** adding any dependency beyond the list above; changing ports; renaming the repo folder.
- **Never:** commit `.env` or database volumes; change web source code beyond paths and the Vite proxy; delete `node_modules` state the user relies on without reinstalling.

## Success criteria

1. `make setup && make db` brings up Postgres; `psql "$DATABASE_URL"` and `$TEST_DATABASE_URL` both connect.
2. `make test` passes: all existing web tests plus the server smoke test.
3. `make lint` passes for both projects.
4. `make security` reports 0 known vulnerabilities for npm and Python packages.
5. `make dev-web` serves the app exactly as before the move; `npm run build` from `web/` produces `web/build/client/index.html`.
6. `README.md` and `AGENTS.md` describe the new layout and commands.

## Open questions

- None beyond the repo-folder rename in [SPEC.md](SPEC.md).
