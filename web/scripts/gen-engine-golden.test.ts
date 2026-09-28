// Golden cases for the Python engine (server/src/recall_engine), produced by this TS engine.
//
//   GEN_GOLDEN=1 npx vitest run scripts/gen-engine-golden.test.ts   # (re)write the file
//   npm test                                                       # check it is still current
//
// Everything is deterministic: fixed instants, fixed presets, seeded random chains.
// Never edit the output by hand (see SPEC-sm2-engine.md).

// Must be set before any Date is used: every case is computed in this zone.
process.env.TZ = "America/New_York";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addDays, dayStartMs, studyDay } from "../app/lib/dates";
import {
  answer,
  EXERCISE_PRESET,
  formatSteps,
  hashString,
  makeRng,
  newCard,
  parseSteps,
  QUESTION_PRESET,
  RATINGS,
  type Card,
  type CardKind,
  type Preset,
  type Rating,
} from "../app/lib/engine";
import type { ReviewRecord } from "../app/lib/progress";
import { doneToday, todayQueue } from "../app/lib/session";

const OUT = fileURLToPath(new URL("../../server/tests/engine/golden/sm2.json", import.meta.url));
const TZ = process.env.TZ!;
const MIN = 60_000;
const DAY = 86_400_000;

/** Local wall-clock instant in TZ (months are 1-based). */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

const PRESETS: Record<string, Preset> = {
  question: QUESTION_PRESET,
  question_nofuzz: { ...QUESTION_PRESET, fuzz: false },
  exercise: EXERCISE_PRESET,
  custom: {
    ...QUESTION_PRESET,
    learnSteps: [0.5, 5, 30, 120],
    relearnSteps: [3, 45],
    graduatingInterval: 2,
    easyInterval: 6,
    startingEase: 2.3,
    lapseFactor: 0.3,
    hardFactor: 1.1,
    easyBonus: 1.5,
    intervalModifier: 0.9,
    minInterval: 2,
    maxInterval: 400,
    leechLapses: 4,
  },
  no_steps: { ...QUESTION_PRESET, learnSteps: [], relearnSteps: [], graduatingInterval: 5 },
  single_step: { ...QUESTION_PRESET, learnSteps: [10], relearnSteps: [20], graduatingInterval: 3 },
};

/** Instants that exercise the 04:00 rollover and both 2026 DST changes in New York. */
const NOWS = [
  at(2026, 6, 15, 12, 0),
  at(2026, 6, 16, 3, 30), // before rollover: still June 15's study day
  at(2026, 3, 7, 22, 0), // day before DST starts (Mar 8)
  at(2026, 10, 31, 22, 0), // day before DST ends (Nov 1)
];

function reviewCard(id: string, kind: CardKind, interval: number, ease: number, dueOffsetDays: number, now: number, lapses = 0): Card {
  const due = dayStartMs(addDays(studyDay(now), dueOffsetDays));
  return {
    ...newCard(id, kind, QUESTION_PRESET),
    phase: "review",
    interval,
    ease,
    due,
    lastReview: dayStartMs(addDays(studyDay(due), -interval)) + 5 * 3_600_000,
    reps: 4,
    lapses,
    updatedAt: 1,
  };
}

function matrixCards(now: number): Card[] {
  const cards: Card[] = [
    newCard("q-new", "question", QUESTION_PRESET),
    { ...newCard("q-l0", "question", QUESTION_PRESET), phase: "learning", step: 0, due: now - MIN, reps: 1 },
    { ...newCard("q-l1", "question", QUESTION_PRESET), phase: "learning", step: 1, due: now, reps: 2 },
    { ...newCard("q-l5", "question", QUESTION_PRESET), phase: "learning", step: 5, due: now, reps: 3 },
    { ...newCard("q-r0", "question", QUESTION_PRESET), phase: "relearning", step: 0, interval: 4, due: now, reps: 6, lapses: 1, ease: 2.3 },
    { ...newCard("q-r1", "question", QUESTION_PRESET), phase: "relearning", step: 1, interval: 9, due: now, reps: 7, lapses: 2, ease: 1.9 },
  ];
  for (const interval of [1, 3, 10, 90, 3000]) {
    for (const ease of [1.3, 2.5]) {
      for (const off of [-9, -1, 0, 4]) cards.push(reviewCard(`rv-${interval}-${ease}-${off}`, "question", interval, ease, off, now));
    }
  }
  for (const lapses of [0, 3, 7]) cards.push(reviewCard(`rv-lapse-${lapses}`, "question", 10, 2.5, 0, now, lapses));
  cards.push({ ...reviewCard("rv-early-nolast", "question", 12, 2.5, 3, now), lastReview: null });
  cards.push(reviewCard("ex-rv", "exercise", 6, 2.5, -2, now));
  cards.push({ ...newCard("ünïcode-𝔘-id", "question", QUESTION_PRESET), phase: "review", interval: 20, due: now - DAY, lastReview: now - 21 * DAY, reps: 9 });
  return cards;
}

type Json = unknown;

function answerCases(): Json[] {
  const out: Json[] = [];
  for (const [presetName, preset] of Object.entries(PRESETS)) {
    for (const now of NOWS) {
      for (const card of matrixCards(now)) {
        for (const rating of RATINGS) out.push({ preset: presetName, card, rating, now, expected: answer(card, rating, now, preset) });
      }
    }
  }
  return out;
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)];
}

function ratingFor(rng: () => number): Rating {
  const x = rng();
  return x < 0.15 ? "again" : x < 0.35 ? "hard" : x < 0.85 ? "good" : "easy";
}

/** Next answer time, relative to the card's state: on time, late, early, mid-step … */
function nextNow(rng: () => number, card: Card, now: number): number {
  if (card.phase === "learning" || card.phase === "relearning") {
    return Math.max(now + 1000, card.due + pick(rng, [-120_000, 0, 60_000, 3_600_000, 5 * 3_600_000, 2 * DAY]));
  }
  if (card.phase === "review") {
    const mode = rng();
    const hour = Math.floor(rng() * 20) * 3_600_000 + Math.floor(rng() * 60) * MIN;
    if (mode < 0.5) return Math.max(now + 1000, card.due + hour);
    if (mode < 0.8) return Math.max(now + 1000, card.due + (1 + Math.floor(rng() * 40)) * DAY + hour);
    return Math.max(now + 1000, card.due - (1 + Math.floor(rng() * Math.max(1, card.interval - 1))) * DAY + hour);
  }
  return now + Math.floor(rng() * 10) * MIN;
}

function chains(): Json[] {
  const rng = makeRng(20260928);
  const names = Object.keys(PRESETS);
  const out: Json[] = [];
  for (let i = 0; i < 160; i++) {
    const presetName = pick(rng, names);
    const kind: CardKind = presetName === "exercise" ? "exercise" : "question";
    const preset = PRESETS[presetName];
    let card = newCard(`chain-${i}`, kind, preset);
    // Start somewhere in 2026 at a random minute, so chains cross both DST changes.
    let now = at(2026, 1, 1, 0, 0) + Math.floor(rng() * 330) * DAY + Math.floor(rng() * 1440) * MIN;
    const steps: Json[] = [];
    for (let s = 0; s < 25; s++) {
      const rating = ratingFor(rng);
      const after = answer(card, rating, now, preset);
      steps.push({ rating, now, expected: after });
      card = after;
      now = nextNow(rng, card, now);
    }
    out.push({ preset: presetName, id: card.id, kind, steps });
  }
  return out;
}

function queueCases(): Json[] {
  const rng = makeRng(424242);
  const out: Json[] = [];
  for (let i = 0; i < 60; i++) {
    const now = at(2026, 1 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 27), Math.floor(rng() * 24), Math.floor(rng() * 60));
    const preset: Preset = {
      ...QUESTION_PRESET,
      newPerDay: Math.floor(rng() * 8),
      reviewsPerDay: Math.floor(rng() * 8),
      learnAheadMinutes: pick(rng, [0, 20, 90]),
    };
    const candidates: string[] = [];
    const cards: Record<string, Card> = {};
    for (let c = 0; c < 25; c++) {
      const id = `q${c}`;
      candidates.push(id);
      const kind = rng();
      const base = newCard(id, "question", QUESTION_PRESET);
      const suspended = rng() < 0.1;
      if (kind < 0.25) continue; // no card yet = new
      if (kind < 0.35) cards[id] = { ...base, suspended };
      else if (kind < 0.55) cards[id] = { ...base, phase: pick(rng, ["learning", "relearning"] as const), due: now + (Math.floor(rng() * 240) - 120) * MIN, suspended };
      else cards[id] = { ...base, phase: "review", interval: 3, due: dayStartMs(addDays(studyDay(now), Math.floor(rng() * 9) - 5)) + Math.floor(rng() * 3) * MIN, suspended };
    }
    const done = { newDone: Math.floor(rng() * 5), reviewsDone: Math.floor(rng() * 5) };
    const learnAhead = rng() < 0.7;
    out.push({ preset, candidates, cards, now, done, learnAhead, expected: todayQueue(candidates, cards, now, preset, done, learnAhead) });
  }
  return out;
}

function doneTodayCases(): Json[] {
  const rng = makeRng(7);
  const out: Json[] = [];
  const phases = ["new", "learning", "review", "relearning"] as const;
  for (let i = 0; i < 40; i++) {
    const now = at(2026, 1 + Math.floor(rng() * 12), 2 + Math.floor(rng() * 26), Math.floor(rng() * 24), Math.floor(rng() * 60));
    const reviews = Array.from({ length: 15 }, () => ({
      at: now - Math.floor(rng() * 48 * 60) * MIN,
      kind: (rng() < 0.7 ? "question" : "exercise") as CardKind,
      before: { phase: pick(rng, phases) },
    }));
    out.push({ now, reviews, expected: doneToday(reviews as unknown as ReviewRecord[], now) });
  }
  return out;
}

function clockCases(): Json[] {
  const instants = [
    ...NOWS,
    at(2026, 3, 8, 1, 59),
    at(2026, 3, 8, 3, 0),
    at(2026, 3, 8, 3, 59),
    at(2026, 3, 8, 4, 0),
    at(2026, 11, 1, 1, 30),
    at(2026, 11, 1, 3, 59),
    at(2026, 11, 1, 4, 0),
    at(2026, 12, 31, 23, 59),
    at(2027, 1, 1, 3, 59),
    at(2027, 1, 1, 4, 0),
    Date.UTC(2026, 6, 1, 7, 59),
    Date.UTC(2026, 6, 1, 8, 0),
  ];
  return instants.map((ms) => {
    const day = studyDay(ms);
    return { ms, studyDay: day, dayStart: dayStartMs(day), plus: [-1, 1, 7, 30, 120].map((n) => ({ n, day: addDays(day, n), start: dayStartMs(addDays(day, n)) })) };
  });
}

function rngCases(): Json {
  const strings = ["", "a", "ch02-q014", "chain-12:7", "ünïcode", "𝔘", "q-l1:2", "x".repeat(300)];
  return {
    hash: strings.map((s) => ({ s, h: hashString(s) })),
    seq: [0, 1, 42, 20260928, 0xffffffff, hashString("ch02-q014:3")].map((seed) => {
      const r = makeRng(seed);
      return { seed, values: Array.from({ length: 8 }, () => r()) };
    }),
  };
}

function stepsCases(): Json {
  const inputs = ["1m 10m", "1m 10m 1d", "30s, 2h", "", "  5   ", "1.5m", "10 minutes", "0m", "3d 1h 45s", "1x"];
  return {
    parse: inputs.map((input) => ({ input, output: parseSteps(input) })),
    format: [[1, 10], [1, 10, 1440, 120], [0.5], [2880, 90], []].map((input) => ({ input, output: formatSteps(input) })),
  };
}

/** One case per line so diffs stay readable. */
function render(): string {
  const section = (name: string, rows: Json[]) => `"${name}": [\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]`;
  const answers = answerCases();
  const chainList = chains();
  const stepCount = answers.length + chainList.reduce((n: number, c) => n + (c as { steps: unknown[] }).steps.length, 0);
  return (
    "{\n" +
    [
      `"generator": "web/scripts/gen-engine-golden.test.ts"`,
      `"tz": ${JSON.stringify(TZ)}`,
      `"stepCount": ${stepCount}`,
      `"presets": ${JSON.stringify(PRESETS)}`,
      `"rng": ${JSON.stringify(rngCases())}`,
      `"steps": ${JSON.stringify(stepsCases())}`,
      section("clock", clockCases()),
      section("answer", answers),
      section("chains", chainList),
      section("queue", queueCases()),
      section("doneToday", doneTodayCases()),
    ].join(",\n") +
    "\n}\n"
  );
}

describe("engine golden file", () => {
  it(process.env.GEN_GOLDEN ? "writes server/tests/engine/golden/sm2.json" : "is up to date with the TS engine", () => {
    const text = render();
    if (process.env.GEN_GOLDEN) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, text);
    }
    expect(readFileSync(OUT, "utf8")).toBe(text);
  });
});
