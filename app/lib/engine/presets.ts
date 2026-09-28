import type { CardKind, Preset } from "./types";

/** Anki's classic defaults. */
export const QUESTION_PRESET: Preset = {
  learnSteps: [1, 10],
  relearnSteps: [10],
  graduatingInterval: 1,
  easyInterval: 4,
  startingEase: 2.5,
  hardFactor: 1.2,
  easyBonus: 1.3,
  intervalModifier: 1,
  lapseFactor: 0,
  minInterval: 1,
  maxInterval: 36500,
  minEase: 1.3,
  fuzz: true,
  newPerDay: 20,
  reviewsPerDay: 200,
  leechLapses: 8,
  learnAheadMinutes: 20,
};

/**
 * Exercises take ~an hour, so there are no minute-level steps: the first rating schedules
 * a redo days out, a lapse comes back in a day or two, and few are introduced per day.
 */
export const EXERCISE_PRESET: Preset = {
  ...QUESTION_PRESET,
  learnSteps: [],
  relearnSteps: [],
  graduatingInterval: 3,
  easyInterval: 7,
  lapseFactor: 0.5,
  maxInterval: 365,
  newPerDay: 1,
  reviewsPerDay: 2,
  learnAheadMinutes: 0,
};

export const PRESETS: Record<CardKind, Preset> = {
  question: QUESTION_PRESET,
  exercise: EXERCISE_PRESET,
};
