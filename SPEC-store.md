# Spec: store

Module of [SPEC.md](SPEC.md). Depends on: `sm2-engine`, `content-model`.

## Objective

The PostgreSQL schema, SQLAlchemy 2.0 models, Alembic migrations and database sessions for course content and learner progress. Content tables arrive in T12, progress tables in T18. Nothing here contains business logic; services in `content-import` and the APIs use these models.

## Tables

Primary keys are UUIDs unless noted; every table has `created_at` / `updated_at` (`timestamptz`, default `now()`).

**Content** (T12)

| Table | Columns | Constraints / indexes |
|---|---|---|
| `learners` | id, name | one default row, id `00000000-0000-0000-0000-000000000001`, created by the migration |
| `courses` | id, slug, title, short, author, description, `scheduling jsonb` (course defaults per kind, Preset field names), content_hash | `slug` unique |
| `units` | id, course_id → courses (cascade), number, title, note_title, folder, position, has_content | unique (course_id, number). Outline entries without a folder are rows with `has_content = false` |
| `sections` | id, unit_id → units (cascade), key, title, position | unique (unit_id, key) |
| `notes` | unit_id (pk) → units (cascade), markdown, content_hash | |
| `items` | id, course_id → courses (cascade), unit_id → units, key, kind (`question` \| `exercise`), type (question type or null), section_keys `text[]`, difficulty, tags `text[]`, `body jsonb`, retired, position, content_hash | unique (course_id, key); index (unit_id, position) |
| `import_runs` | id, course_id → courses (cascade), at, content_hash, `summary jsonb`, dry_run | index (course_id, at) |

`items.body` is the full validated item as the API serves it (camelCase, `id` = key), so reads need no reshaping.

**Progress** (T18): every row belongs to one learner, and through its item or course to one course.

| Table | Columns | Constraints / indexes |
|---|---|---|
| `cards` | (learner_id, item_id) pk, phase, step, due `timestamptz`, interval_days, ease `double precision`, reps, lapses, last_review, last_rating, leech, suspended | index (learner_id, due); check phase / rating values |
| `reviews` | id `text` pk (client-generated), learner_id, item_id, course_id, kind, source, session_id `text`, at, rating, correct, answer, hinted, overridden, `before jsonb`, `after jsonb`, duration_ms, `meta jsonb` | index (learner_id, course_id, at), (learner_id, item_id) |
| `sessions` | id `text` pk, learner_id, course_id, mode, started_at, completed_at, completed_day `date` | index (learner_id, course_id, completed_day) |
| `exercise_states` | (learner_id, item_id) pk, status, notes, attempt, attempt_started_at, tests_passed `text[]`, hints_revealed | |
| `learner_settings` | learner_id pk, theme, show_key_hints, time_zone (IANA, default `UTC`), `prefs jsonb` | |
| `course_settings` | (learner_id, course_id) pk, `scheduling jsonb` (learner overrides per kind), last_unit | |

Times are stored as `timestamptz` and exchanged as UTC epoch milliseconds; `recall_api.timeconv` converts at the boundary.

## Code layout

```
server/src/recall_api/
  config.py     Settings from env: DATABASE_URL (required), TEST_DATABASE_URL
  db.py         engine + sessionmaker; session_scope() for CLI; per-request session for Flask
  models.py     SQLAlchemy 2.0 declarative models (Mapped[...], mapped_column)
  timeconv.py   ms <-> datetime helpers
server/migrations/        Alembic env + versions (0001_content, 0002_progress)
server/alembic.ini
server/tests/conftest.py  db fixtures: schema from migrations once per run; each test in a rolled-back transaction
server/tests/store/
```

## Code style

```python
class Item(Base):
    __tablename__ = "items"
    __table_args__ = (UniqueConstraint("course_id", "key"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    key: Mapped[str]
    body: Mapped[dict[str, Any]] = mapped_column(JSONB)
```

## Testing strategy

- pytest against the `recall_test` database (from `TEST_DATABASE_URL`). The schema is built once per test run by running the Alembic migrations, which also tests them.
- Each test runs inside a transaction that is rolled back, so tests are independent and fast.
- Migration test: upgrade to head, downgrade to base, upgrade again, on an empty database.

## Boundaries

- **Always:** change the schema only through a new Alembic migration; keep models free of business logic.
- **Ask first:** dropping or renaming columns once data exists; any change to how progress rows are keyed.
- **Never:** delete learner progress in a migration; store local times.

## Success criteria

1. `alembic upgrade head` on an empty database creates every table and the default learner; `downgrade base` removes them.
2. Unique keys and foreign keys are enforced (tests insert violating rows and expect errors).
3. A test can create a course and items inside its transaction and see nothing left afterwards.
