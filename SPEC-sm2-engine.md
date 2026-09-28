# Spec: sm2-engine

Module of [SPEC.md](SPEC.md). Depends on: `platform`.

## Objective

A pure Python implementation of Recall's scheduler (Anki's classic SM-2 variant) that becomes the single source of truth for when every card is due. It replaces the TypeScript engine in `web/app/lib/engine/`, so it must produce **identical** results: same intervals, same ease, same due timestamps to the millisecond, same fuzz.

"Pure" means: Python standard library only, no I/O, no global state, no clock reads. Every function takes the time and the learner's clock as arguments and returns new values.

Users of this module: `learning-api` (applies ratings, builds today's queue, computes course card counts) and `store` (persists `Card`).

## Public interface

```python
from recall_engine import (
    Card, CardKind, Phase, Rating, Preset, PresetOverrides, StudyClock, DoneToday, TodayQueue,
    new_card, answer, preview, resolve_preset, is_due, is_mastered,
    study_day, day_start_ms, today_queue, done_today, parse_steps, format_steps,
    QUESTION_PRESET, EXERCISE_PRESET, MATURE_DAYS,
)

clock = StudyClock(tz="America/Los_Angeles")           # rollover_hour=4
preset = resolve_preset(CardKind.QUESTION, overrides)   # course defaults + learner overrides
card = new_card("ch02-q014", CardKind.QUESTION, preset)
after = answer(card, Rating.GOOD, now_ms, preset, clock)
buttons = preview(after, now_ms, preset, clock)          # dict[Rating, Card]
```

| Function | Behaviour (same as the TS engine unless noted) |
|---|---|
| `answer(card, rating, now_ms, preset, clock) → Card` | Learning steps, graduation, review multipliers, ease changes, late-answer credit, early-answer rule, +1-day minimums, fuzz, lapses, relearning, leech flag, max interval; increments reps; sets last_review, last_rating, updated_at |
| `preview(card, now_ms, preset, clock) → dict[Rating, Card]` | `answer` for each rating; used for button labels |
| `resolve_preset(kind, *layers) → Preset` | Engine defaults, then each override layer in order (course defaults, then learner overrides). Unknown keys are rejected |
| `study_day(ms, clock) → date` / `day_start_ms(day, clock) → int` | Study day and its 04:00 start **in the learner's time zone** (TS used the browser's zone) |
| `is_due(card, now_ms)` · `is_mastered(card)` | Not suspended, not new, due ≤ now · review phase with interval ≥ 21 days |
| `done_today(reviews, now_ms, clock) → dict[CardKind, DoneToday]` | New cards introduced and reviews done this study day |
| `today_queue(candidate_ids, cards, now_ms, preset, done, learn_ahead=True) → TodayQueue` | Learning (incl. learn-ahead window), due reviews oldest first up to reviews/day, unseen cards up to new/day |
| `parse_steps("1m 10m 1d") → list[float]` · `format_steps` | Anki-style step strings, used to validate settings |

Types are `@dataclass(frozen=True, slots=True)`; enums are `StrEnum`; timestamps are `int` epoch milliseconds; intervals are whole days. Session ordering (`nextInSession`) and interval labels (`formatDue`) are presentation and stay in the web client.

## Time handling

Decided 2026-09-28: **store UTC, use the learner's time zone only for day boundaries.**

- Every timestamp the engine reads or writes (`now_ms`, `due`, `last_review`, `updated_at`) is a UTC instant in epoch milliseconds. Postgres stores them as `timestamptz`; the browser converts to local time only for display.
- Intervals are whole days, and a day starts at 04:00 in the learner's IANA zone (`StudyClock.tz`, from learner settings). The engine uses the zone at exactly three points:
  1. **Due dates of review cards:** "N days" means 04:00 local on the Nth study day after `now`, converted to a UTC instant before it is returned. Learning and relearning steps are plain minute offsets from `now` and ignore the zone.
  2. **Daily limits:** `done_today` counts reviews since the start of the current study day.
  3. **Streak days:** a session belongs to the study day its completion falls in.
- Because due dates are already UTC instants, "what's due" is a plain UTC comparison (`due <= now`, or `WHERE due <= now()` in SQL). Nothing on the server does time-zone math at read time.
- Why not pure elapsed time (`due = last_review + N × 24h`): cards would fall due at the time of day they were last answered and trickle in all day; daily limits and streaks would reset at UTC midnight (5 pm in California). Day boundaries match how people study and match Anki and the current app.
- If the learner changes time zone, existing due instants stay as they are; new answers use the new zone.

## Parity with the TypeScript engine

Parity is proven, not argued:

1. **Golden cases generated from the TS engine.** A generator (`web/scripts/gen-engine-golden.test.ts`, run with `TZ=America/New_York GEN_GOLDEN=1 npx vitest run …`) wrote `server/tests/engine/golden/sm2.json`. The TS engine and the generator were retired in T25 (see git history); the file is now a frozen regression suite:
   - every phase × rating × preset (question defaults, exercise defaults, no fuzz, custom overrides, empty steps, shortened steps mid-card);
   - review cards on time, late (1, 3, 8, 30 days) and early; ease floor; leech threshold; max interval;
   - `now` values around the 04:00 rollover and across both 2026 DST changes in the fixture zone (Mar 8, Nov 1);
   - 200 seeded random chains of 30 ratings each with random gaps, recording every intermediate card;
   - `today_queue` / `done_today` cases.
2. **The Python tests replay every case** with `StudyClock(tz=<fixture tz>)` and require exact equality of every field.
3. The golden file is committed. Once `web-client` removes the TS engine, it stays as the Python engine's regression suite.

Known JS → Python traps the port must handle (each gets a named unit test):

| Trap | JS behaviour to reproduce |
|---|---|
| Rounding | `Math.round` rounds .5 up (toward +∞); Python's `round` rounds to even |
| Fuzz RNG | mulberry32 and FNV-1a use 32-bit integer maths (`Math.imul`, `>>> 0`); mask with `& 0xFFFFFFFF` |
| String hashing | `charCodeAt` iterates UTF-16 code units, not code points |
| Day arithmetic | JS `setDate(+n)` then `setHours(4)` in local time; use `zoneinfo` with date arithmetic, not `timedelta(hours=24·n)`, so DST days are 23/25 h |

## Project structure

```
server/src/recall_engine/
  __init__.py      public API (re-exports only)
  types.py         Card, Phase, Rating, CardKind, Preset, DoneToday, TodayQueue
  presets.py       QUESTION_PRESET, EXERCISE_PRESET, resolve_preset
  clock.py         StudyClock, study_day, day_start_ms, add_days
  rng.py           mulberry32, fnv1a (JS-compatible)
  jsmath.py        js_round and other JS-compatible helpers
  sm2.py           answer, preview (the scheduler)
  steps.py         parse_steps, format_steps
  queue.py         is_due, is_mastered, done_today, today_queue
server/tests/engine/
  test_sm2.py      behaviour tests ported from engine.test.ts (readable, one rule each)
  test_traps.py    rounding, RNG, UTF-16, DST
  test_golden.py   replays golden/sm2.json
  test_purity.py   imports only stdlib modules
  golden/sm2.json
```

## Code style

```python
def _fuzz(interval: int, rng: Callable[[], float]) -> int:
    """Anki v2 fuzz ranges; keeps cards learned together from falling due together."""
    if interval < 2:
        return interval
    if interval == 2:
        return 2 + math.floor(rng() * 2)
    spread = max(1, math.floor(interval * 0.25) if interval < 7 else ...)
    return interval - spread + math.floor(rng() * (2 * spread + 1))
```

Small private helpers, one rule per function, names that match the TS engine's (`hard_delay`, `graduate`, `constrain`) so the two can be compared side by side during the port.

## Testing strategy

- **Framework:** pytest, in `server/tests/engine/`.
- **Levels:** readable behaviour tests for each rule (ported from the 19 TS engine tests) · trap tests · the golden replay (thousands of cases) · a purity test that walks the package's imports and fails on anything outside `sys.stdlib_module_names`.
- **Coverage:** 100% of lines and branches in `recall_engine` (measured with `coverage`, a dev dependency to approve).
- **Type checking:** pyright strict passes on `recall_engine`.

## Boundaries

- **Always:** keep functions pure (time and clock passed in); match TS results exactly; add a golden case for every bug found.
- **Ask first:** any intentional behaviour change from the TS engine (it would also change the product spec §6); adding FSRS; adding any dependency.
- **Never:** read the system clock or time zone inside the engine; import Flask, SQLAlchemy, Pydantic or anything outside the standard library; edit golden cases by hand to make a test pass.

## Success criteria

1. Every golden case matches exactly (all fields, due to the millisecond); at least 5,000 recorded steps.
2. All ported behaviour tests pass, including DST and 04:00 rollover in a non-UTC zone.
3. `test_purity.py` passes; pyright strict passes; coverage is 100% lines and branches.
4. `today_queue` over 10,000 cards runs in under 50 ms on this machine.

## Open questions

- None. (Time zone source is settled in [SPEC.md](SPEC.md): stored in learner settings, sent by the browser.)
