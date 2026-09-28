import { describe, expect, it } from "vitest";
import { addDays, dayStartMs, studyDay } from "../dates";
import { answer, formatDue, isDue, isMastered, newCard, preview, EXERCISE_PRESET, QUESTION_PRESET, type Card } from ".";
import { sm2 as s } from "./sm2";

const MIN = 60_000;
// Noon on a fixed day, well clear of the 4am rollover.
const NOW = new Date(2026, 8, 27, 12, 0, 0).getTime();
const TODAY = studyDay(NOW);
const dueIn = (days: number) => dayStartMs(addDays(TODAY, days));

const q = () => newCard("q1", "question", QUESTION_PRESET);
const ex = () => newCard("e1", "exercise", EXERCISE_PRESET);
/** A review card whose interval ends today. */
const reviewCard = (interval: number, ease = 2.5, over: Partial<Card> = {}): Card => ({
  ...q(),
  phase: "review",
  interval,
  ease,
  due: dayStartMs(TODAY),
  lastReview: dayStartMs(addDays(TODAY, -interval)),
  reps: 5,
  ...over,
});
const noFuzz = { ...QUESTION_PRESET, fuzz: false };

describe("learning (new cards, steps 1m 10m)", () => {
  it("again → first step, hard on step 0 → average of first two steps, good → next step", () => {
    expect(answer(q(), "again", NOW)).toMatchObject({ phase: "learning", step: 0, due: NOW + 1 * MIN });
    expect(answer(q(), "hard", NOW)).toMatchObject({ phase: "learning", step: 0, due: NOW + 5.5 * MIN });
    expect(answer(q(), "good", NOW)).toMatchObject({ phase: "learning", step: 1, due: NOW + 10 * MIN });
  });

  it("good on the last step graduates to 1 day; easy graduates straight to 4 days", () => {
    const step1 = answer(q(), "good", NOW);
    expect(answer(step1, "good", NOW)).toMatchObject({ phase: "review", interval: 1, due: dueIn(1) });
    expect(answer(q(), "easy", NOW)).toMatchObject({ phase: "review", interval: 4, due: dueIn(4) });
  });

  it("never changes ease while learning", () => {
    let c = q();
    for (const r of ["again", "hard", "again", "good", "good"] as const) c = answer(c, r, NOW);
    expect(c.ease).toBe(2.5);
    expect(c.reps).toBe(5);
  });
});

describe("review cards (SM-2 multipliers, no fuzz)", () => {
  // The scheduler is called directly with a no-fuzz preset so intervals are exact.
  it("hard ×1.2 −15 ease, good ×ease, easy ×ease×1.3 +15 ease", () => {
    const c = reviewCard(10);
    expect(s.next(c, "hard", NOW, noFuzz)).toMatchObject({ interval: 12, ease: 2.35, due: dueIn(12) });
    expect(s.next(c, "good", NOW, noFuzz)).toMatchObject({ interval: 25, ease: 2.5 });
    expect(s.next(c, "easy", NOW, noFuzz)).toMatchObject({ interval: 33, ease: 2.65 });
  });

  it("each answer is at least a day longer than the previous interval / the answer below it", () => {
    const c = reviewCard(1, 1.3);
    const hard = s.next(c, "hard", NOW, noFuzz).interval;
    const good = s.next(c, "good", NOW, noFuzz).interval;
    const easy = s.next(c, "easy", NOW, noFuzz).interval;
    expect(hard).toBe(2);
    expect(good).toBe(3);
    expect(easy).toBe(4);
  });

  it("credits late days: good adds half, easy all, hard a quarter", () => {
    const c = reviewCard(10, 2.5, { due: dayStartMs(addDays(TODAY, -8)), lastReview: dayStartMs(addDays(TODAY, -18)) });
    expect(s.next(c, "hard", NOW, noFuzz).interval).toBe(Math.round((10 + 2) * 1.2));
    expect(s.next(c, "good", NOW, noFuzz).interval).toBe(Math.round((10 + 4) * 2.5));
    expect(s.next(c, "easy", NOW, noFuzz).interval).toBe(Math.round((10 + 8) * 2.5 * 1.3));
  });

  it("answering early never shortens the interval", () => {
    // Interval 30, reviewed 2 days ago, due in 28 days.
    const c = reviewCard(30, 2.5, { due: dayStartMs(addDays(TODAY, 28)), lastReview: dayStartMs(addDays(TODAY, -2)) });
    expect(s.next(c, "good", NOW, noFuzz).interval).toBe(30);
    expect(s.next(c, "hard", NOW, noFuzz).interval).toBe(30);
  });

  it("again: lapse, −20 ease (floor 130%), relearn in 10m, then back at the minimum interval", () => {
    const lapsed = s.next(reviewCard(40, 1.4), "again", NOW, noFuzz);
    expect(lapsed).toMatchObject({ phase: "relearning", step: 0, due: NOW + 10 * MIN, lapses: 1, ease: 1.3, interval: 1 });
    expect(s.next(lapsed, "good", NOW, noFuzz)).toMatchObject({ phase: "review", interval: 1, due: dueIn(1) });
  });

  it("tags a leech at 8 lapses", () => {
    expect(s.next(reviewCard(5, 2.5, { lapses: 6 }), "again", NOW, noFuzz).leech).toBe(false);
    expect(s.next(reviewCard(5, 2.5, { lapses: 7 }), "again", NOW, noFuzz).leech).toBe(true);
  });

  it("caps at the max interval", () => {
    expect(s.next(reviewCard(30000), "easy", NOW, noFuzz).interval).toBe(QUESTION_PRESET.maxInterval);
  });
});

describe("fuzz", () => {
  it("stays within Anki's ranges, is deterministic, and preview matches the real answer", () => {
    const c = reviewCard(10);
    const a = answer(c, "good", NOW);
    expect(a.interval).toBeGreaterThanOrEqual(25 - 3);
    expect(a.interval).toBeLessThanOrEqual(25 + 3);
    expect(answer(c, "good", NOW)).toEqual(a);
    expect(preview(c, NOW).good).toEqual(a);
  });

  it("spreads cards learned together", () => {
    const intervals = new Set(
      Array.from({ length: 30 }, (_, i) => answer(reviewCard(20, 2.5, { id: `q${i}` }), "good", NOW).interval),
    );
    expect(intervals.size).toBeGreaterThan(3);
  });
});

describe("exercise preset (no minute steps)", () => {
  it("first rating schedules days out", () => {
    expect(answer(ex(), "again", NOW)).toMatchObject({ phase: "review", interval: 1 });
    expect(answer(ex(), "hard", NOW)).toMatchObject({ phase: "review", interval: 2 });
    expect(answer(ex(), "good", NOW)).toMatchObject({ phase: "review", interval: 3, due: dueIn(3) });
    expect(answer(ex(), "easy", NOW)).toMatchObject({ phase: "review", interval: 7 });
  });

  it("a lapse halves the interval and skips relearning", () => {
    const c: Card = { ...ex(), phase: "review", interval: 20, due: dayStartMs(TODAY), lastReview: dayStartMs(addDays(TODAY, -20)), reps: 3 };
    expect(answer(c, "again", NOW)).toMatchObject({ phase: "review", interval: 10, lapses: 1, due: dueIn(10) });
  });
});

describe("helpers", () => {
  it("due, mastery and labels", () => {
    expect(isDue(q(), NOW)).toBe(false);
    const learning = answer(q(), "again", NOW);
    expect(isDue(learning, NOW)).toBe(false);
    expect(isDue(learning, NOW + MIN)).toBe(true);
    expect(isDue({ ...learning, suspended: true }, NOW + MIN)).toBe(false);
    expect(isMastered(reviewCard(20))).toBe(false);
    expect(isMastered(reviewCard(21))).toBe(true);
    const p = preview(q(), NOW);
    expect([p.again, p.hard, p.good, p.easy].map((c) => formatDue(c, NOW))).toEqual(["1m", "6m", "10m", "4d"]);
  });

  it("study days roll over at 4am", () => {
    const lateNight = new Date(2026, 8, 28, 2, 30).getTime();
    expect(studyDay(lateNight)).toBe("2026-09-27");
    expect(studyDay(new Date(2026, 8, 28, 4, 0).getTime())).toBe("2026-09-28");
  });
});

describe("configurable presets", () => {
  it("parses and formats Anki-style steps", async () => {
    const { parseSteps, formatSteps } = await import("./steps");
    expect(parseSteps("1m 10m 1d")).toEqual([1, 10, 1440]);
    expect(parseSteps("30s, 2h")).toEqual([0.5, 120]);
    expect(parseSteps("")).toEqual([]);
    expect(parseSteps("10 minutes")).toBeNull();
    expect(parseSteps("0m")).toBeNull();
    expect(formatSteps([1, 10, 1440, 120])).toBe("1m 10m 1d 2h");
  });

  it("overrides apply on top of the defaults", async () => {
    const { resolvePreset } = await import(".");
    const p = resolvePreset("question", { question: { learnSteps: [5], graduatingInterval: 2 } });
    expect(p.learnSteps).toEqual([5]);
    expect(p.easyInterval).toBe(4);
    expect(answer(q(), "good", NOW, p)).toMatchObject({ phase: "review", interval: 2 });
    expect(resolvePreset("exercise", { question: { graduatingInterval: 9 } }).graduatingInterval).toBe(3);
  });

  it("copes with steps shortened or removed while a card is mid-step", () => {
    const learning = { ...answer(answer(q(), "good", NOW), "again", NOW), step: 5 };
    expect(answer(learning, "good", NOW, { ...QUESTION_PRESET, learnSteps: [1, 10] }).phase).toBe("review");
    const relearning: Card = { ...q(), phase: "relearning", step: 3, interval: 4, reps: 4 };
    expect(answer(relearning, "good", NOW, { ...QUESTION_PRESET, relearnSteps: [] })).toMatchObject({ phase: "review", interval: 4 });
  });
});
