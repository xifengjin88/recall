# AGENTS.md

Instructions for coding agents working in this repository. Claude Code reads this through `CLAUDE.md`; other agents read it directly.

## Project

**Recall** is a spaced-repetition study app: quizzes, flashcards and hands-on exercises, scheduled by an Anki-style SM-2 engine. Its first course is *The Linux Programming Interface* ("TLPI"). The goal is a white-label app with many courses, each with its own study state, so keep the product (`app/config.ts`) separate from course content, and keep the engine and storage course-agnostic.

- Product spec (what the learner sees and does): `docs/SPEC.md`
- Engineering specs: `SPEC.md` (capability map and decisions) and `SPEC-<module>.md`
- Current plan and task list: `tasks/plan.md`, `tasks/todo.md`

## Current state and migration in progress

Today the repo is a single React app at the root, with content bundled in the JS and progress in the browser's IndexedDB. **Milestone 1** (see `SPEC.md`) turns it into a monorepo:

```
web/        the React app (moved from the root in task T1)
server/     Python: recall_engine (pure SM-2), recall_content (schemas + parser), recall_api (Flask)
courses/    course content: YAML + Markdown, imported into Postgres by `recall content import`
compose.yaml  PostgreSQL 17
```

Check `tasks/todo.md` for which tasks are done before assuming a path exists. Until T1 lands, web paths below are at the repo root instead of under `web/`.

## Workflow

- **Spec first.** Specs are gated: don't implement a module whose `SPEC-<module>.md` hasn't been approved. If a decision changes, update the spec before the code.
- **One task at a time** from `tasks/todo.md`, in order. Tick its acceptance criteria only after running its verification commands. Stop at each checkpoint for human review.
- **Keep every task in a working state:** tests, typecheck and build pass at the end of each task.
- The user checks the UI in the browser themselves; don't run long browser-automation loops unless asked.

## Commands

Web (repo root today, `web/` after T1):

```sh
npm run dev          # Vite dev server
npm test             # vitest
npm run typecheck    # react-router typegen + tsc
npm run build        # static SPA in build/client/
npm run security     # npm audit + signatures + OSV.dev CVE lookup
```

Monorepo (after T3; see SPEC-platform.md):

```sh
make setup | db | db-reset | dev-server | dev-web | test | lint | security
```

## Architecture rules

- **Server owns scheduling** (once Phase 5 lands). The browser sends rating events; the server runs `recall_engine` and returns the card and button previews. Don't add scheduling logic to the web app.
- **`recall_engine` is pure:** standard library only, no I/O, never reads the clock or time zone itself. Time and a `StudyClock` are always passed in. Results must match the golden cases in `server/tests/engine/golden/`; never edit those by hand.
- **Time:** store and send UTC (Postgres `timestamptz`, epoch ms on the wire). The learner's IANA time zone is used only for day boundaries (study day starts 04:00 local): review due dates, daily limits, streaks.
- **Wire format:** JSON, camelCase keys (Pydantic aliases), snake_case in Python. Content is referenced by item key (`ch02-q014`), never by database id.
- **Per-course state:** cards, reviews, sessions, exercise state and scheduling overrides all belong to one learner and one course. No cross-course sessions.
- **Content ids are permanent.** Question and exercise keys are never renumbered or reused; remove an item by retiring it (`retired: true`, or deleting it from the files, which the importer turns into a retire). History is kept.
- **Notes headings:** a note heading starting with a section key (`## 2.7 …`) gets the id `s2.7`; every section needs one. The validator reports missing ones.
- Server layers: `api/` handlers parse with Pydantic and call one service; `services/` hold logic and transactions and take/return Pydantic models; `models/` are tables only.

## Web conventions

- React 19, React Router 8 **framework mode** running as an **SPA** (`ssr: false`). Routes are still rendered once at build time, so touch `window`/`localStorage` only in effects, event handlers or `clientLoader`, never during render.
- React Router's docs for the installed version are in `node_modules/react-router/docs/`; check them before using a router API.
- Tailwind v4 (CSS-first config in `app/app.css`) and shadcn/ui (radix-nova, lucide icons). Add components with `npx shadcn@latest add <name>`; don't hand-edit `app/components/ui/*` without a reason.
- Keep `isbot` installed: the default server entry needs it for the build-time render.
- Keyboard shortcuts go through `app/hooks/use-hotkeys.ts`; each route lists its shortcuts in `handle.shortcuts` for the `?` overlay.
- Pure logic lives in `app/lib/` and gets vitest tests.

## Python conventions

- Python 3.13 via uv. ruff (lint + format, line length 110), pyright (strict for `recall_engine`), pytest.
- snake_case functions and fields, PascalCase classes, `StrEnum` for enums, `@dataclass(frozen=True, slots=True)` for engine values, Pydantic v2 models with `extra="forbid"` at the edges.
- Tests against a real Postgres test database (`recall_test`), each test in a rolled-back transaction.

## Dependencies and security

- Adding any dependency (npm or Python) needs the user's approval first.
- After installing or upgrading anything, run the security checks (`npm run security`; after T2 also `make security`, which adds `pip-audit` and an OSV.dev lookup for Python packages). Don't leave a known vulnerability in place: pin a fixed version or pick another package, and tell the user.

## Boundaries

- **Always:** run the task's verification commands before marking it done; keep secrets in `.env`; report test failures honestly with output.
- **Ask first:** schema migrations beyond the planned ones; new dependencies; changing the content file format or field names; any intentional change to scheduling behaviour; renaming the repo folder or a course slug.
- **Never:** commit `.env`, database volumes or generated build output; edit golden test files by hand; delete or weaken failing tests to get to green; read the clock inside `recall_engine`; drop learner progress (export or back it up first).
