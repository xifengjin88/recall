# Spec: web-client

Module of [SPEC.md](SPEC.md). Depends on: `catalog-api`, `learning-api`.

## Objective

The React app running entirely on the API: content from the catalog (done in T16–T17), progress and scheduling from the learning API. Screens look and behave as today; the only visible additions are the course grid and a notice when local progress is uploaded.

## Changes

- **Progress store** (`web/app/state/progress-store.ts`) keeps its hooks (`useProgress`, `useStoreStatus`) and action names, but loads from `GET /progress` and sends every change to the API. Actions whose result the server decides become async and resolve with the server's objects:
  - `recordReview(...) → Promise<{before, after}>`, `overrideReview(...) → Promise<…>`
  - `previewCard(itemKey) → Promise<Previews>` for flashcard and exercise rating buttons
  - other actions (settings, prefs, exercise state, sessions, suspend) update memory at once and send in order; a failure shows the existing "Couldn't save" notice.
- **Queue and counts** come from `POST /queue` and `GET /today`; session setup keeps its filters (chapter, sections, types, difficulty, order), applies them first, and sends the remaining keys in order as `candidates`, so the server's daily limits apply to what the learner picked.
- **Scheduling settings** read `GET /scheduling` (defaults, overrides, effective) and write `PATCH /scheduling`; field validation messages come from the server.
- **Time zone:** on load, the browser sends `Intl.DateTimeFormat().resolvedOptions().timeZone` to `PATCH /api/settings` if it differs.
- **Retire the TS engine:** delete `app/lib/engine/{sm2,presets,rng,index}` and the queue functions; keep presentation helpers in `app/lib/cards.ts` (`isDue`, `isMastered`, `formatDue`, `formatDays`, `MATURE_DAYS`) and step parsing for inputs. The golden generator is removed; `server/tests/engine/golden/sm2.json` stays as the Python engine's regression suite.
- **Retire IndexedDB:** on first load of a course in a browser, its IndexedDB (`recall-<slug>`, read with the plain IndexedDB API) and, for TLPI, the first version's localStorage key are uploaded with `PUT /progress`: `replace` when the server has nothing for the course (so the browser's settings and scheduling overrides come along), `merge` otherwise. A localStorage flag records the upload; a one-time notice says so; the local copies are kept as a backup; a failure leaves everything in place and retries on the next load. Dexie and `idb-repo.ts` are removed; fake-indexeddb stays as a dev dependency to test the upload.

## Testing strategy

- vitest with `fetch` mocked by a small in-memory fake of the API (routes → handlers), covering: load, record review (returns server card), override, previews, exercise flow, settings, first-run upload.
- `npm run typecheck` with the samples contract (T15) extended to the learning API responses.
- Manual: quiz, flashcards, an exercise on a test course, settings, stats, with Postgres checked by `psql`.

## Boundaries

- **Always:** keep screens' behaviour and keyboard flows; show server errors instead of failing silently.
- **Ask first:** visible UI changes beyond the course grid and upload notice.
- **Never:** compute scheduling in the browser; drop local progress before the upload has succeeded.

## Success criteria

1. Answering a quiz question writes a card and a review to Postgres; reloading shows the same state.
2. Your current browser progress for TLPI appears on the server after first load; the local copy is kept.
3. The web bundle no longer contains the SM-2 engine or Dexie.
4. `make test lint security` passes.
