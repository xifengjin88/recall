# Spec: content-import

Module of [SPEC.md](SPEC.md). Depends on: `content-model`, `store`.

## Objective

A `recall` command-line tool that validates a course folder and stores it in Postgres, safely and repeatably, so course files in git stay the source of truth for content.

## Commands

```sh
uv run recall content validate ../courses/tlpi          # parse + rules only; exit 1 on errors
uv run recall content import ../courses/tlpi            # validate, then upsert in one transaction
uv run recall content import ../courses/tlpi --dry-run  # same, then roll back; prints what would change
uv run recall content export tlpi ../out/tlpi           # database → course folder (write_course)
uv run recall db upgrade                                 # alembic upgrade head
```

The `recall` entry point is a Click group (Click ships with Flask). It reads `DATABASE_URL` from the environment (`uv run --env-file ../.env …`, or `make` targets).

## Import rules

1. Parse with `recall_content.parse_course`. On any error, print every error (`file:line key: message`), write nothing, exit 1.
2. In one transaction:
   - upsert the course by slug (title, short, author, description, scheduling, content_hash);
   - upsert units by (course, number) for every outline entry; `has_content` true for units with a folder; outline titles win for units without a folder;
   - replace each content unit's sections and notes;
   - upsert items by (course, key): insert new ones, update changed ones (content hash differs), leave unchanged ones untouched (no write);
   - items in the database but missing from the files are **retired**, never deleted; an item that reappears is un-retired;
   - record an `import_runs` row with the summary.
3. Print `added N · changed N · retired N · unchanged N` (and `units`, `notes` changes). `--dry-run` rolls back after printing.

Deleting a course is not supported by the CLI in this milestone.

## Code layout

```
server/src/recall_api/
  cli.py                 click group: content validate/import/export, db upgrade
  services/content.py    import_course(session, parsed, dry_run) -> ImportSummary; export_course(session, slug) -> ParsedCourse
server/tests/content_import/test_import.py
```

## Testing strategy

- pytest against `recall_test`, each test in a rolled-back transaction, using the fixture course from `tests/content/fixtures/valid-course` and the real `courses/tlpi`.
- Cases: first import adds everything; second import changes nothing (and issues no UPDATEs to items); editing one question changes exactly one; removing one retires it and keeps its row; restoring it un-retires; invalid course writes nothing and exits 1; dry run leaves the database unchanged; export → parse equals the imported course.
- CLI tests use Click's `CliRunner`.

## Boundaries

- **Always:** import atomically; retire instead of delete; keep the item key as identity.
- **Ask first:** supporting course deletion or key renames.
- **Never:** partially import an invalid course; delete items that learners may have history for.

## Success criteria

1. First import of `courses/tlpi` reports `added 50`; the second reports `unchanged 50` with zero item writes.
2. Removing a question from the file retires it (row kept); restoring un-retires.
3. An invalid course prints all errors, writes nothing, exits 1.
4. `export` then `parse_course` gives the same `ParsedCourse` (same content hash).
