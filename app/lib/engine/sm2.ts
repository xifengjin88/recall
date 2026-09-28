// Anki's classic (SM-2 derived) scheduler.
// Reference: https://faqs.ankiweb.net/what-spaced-repetition-algorithm.html and Anki's
// v2 scheduler for the late-review bonus and fuzz ranges.

import { addDays, dayStartMs, daysBetween, studyDay } from "../dates";
import { hashString, makeRng } from "./rng";
import type { Card, CardKind, Minutes, Preset, Rating, Scheduler } from "./types";

const MINUTE = 60_000;

export function newCard(id: string, kind: CardKind, preset: Preset): Card {
  return {
    id,
    kind,
    phase: "new",
    step: 0,
    due: 0,
    interval: 0,
    ease: preset.startingEase,
    reps: 0,
    lapses: 0,
    lastReview: null,
    lastRating: null,
    leech: false,
    suspended: false,
    updatedAt: 0,
  };
}

/** Start of the study day `days` after the one `now` falls in. */
const reviewDue = (now: number, days: number) => dayStartMs(addDays(studyDay(now), days));

/** Delay for Hard: repeat the current step, or on the first step the average of the first two. */
function hardDelay(steps: Minutes[], step: number): Minutes {
  if (step > 0) return steps[step];
  if (steps.length > 1) return (steps[0] + steps[1]) / 2;
  return Math.min(steps[0] * 1.5, steps[0] + 24 * 60);
}

/** Anki v2 fuzz: a random spread so cards learned together don't all fall due together. */
function fuzz(ivl: number, rng: () => number): number {
  if (ivl < 2) return ivl;
  if (ivl === 2) return 2 + Math.floor(rng() * 2);
  const f = Math.max(1, ivl < 7 ? Math.floor(ivl * 0.25) : ivl < 30 ? Math.max(2, Math.floor(ivl * 0.15)) : Math.max(4, Math.floor(ivl * 0.05)));
  return ivl - f + Math.floor(rng() * (2 * f + 1));
}

function constrain(raw: number, atLeast: number, p: Preset, rng: () => number): number {
  let ivl = Math.round(raw * p.intervalModifier);
  if (p.fuzz) ivl = fuzz(ivl, rng);
  return Math.max(1, Math.min(Math.max(ivl, atLeast), p.maxInterval));
}

function graduate(card: Card, days: number, now: number): Card {
  return { ...card, phase: "review", step: 0, interval: days, due: reviewDue(now, days) };
}

/** New and learning cards: minute steps, then graduate. Ease isn't touched. */
function learn(card: Card, rating: Rating, now: number, p: Preset): Card {
  const steps = p.learnSteps;
  // Clamp in case the steps were shortened in Settings while this card was learning.
  const step = card.phase === "new" ? 0 : Math.min(card.step, Math.max(0, steps.length - 1));
  if (steps.length === 0) {
    // No steps (exercises): the first answer schedules straight into review.
    const days = { again: p.minInterval, hard: Math.max(p.minInterval, Math.round(p.graduatingInterval / 2)), good: p.graduatingInterval, easy: p.easyInterval }[rating];
    return graduate(card, days, now);
  }
  switch (rating) {
    case "again":
      return { ...card, phase: "learning", step: 0, due: now + steps[0] * MINUTE };
    case "hard":
      return { ...card, phase: "learning", step, due: now + hardDelay(steps, step) * MINUTE };
    case "good":
      if (step + 1 < steps.length) return { ...card, phase: "learning", step: step + 1, due: now + steps[step + 1] * MINUTE };
      return graduate(card, p.graduatingInterval, now);
    case "easy":
      return graduate(card, p.easyInterval, now);
  }
}

/** Relearning after a lapse: minute steps, then back to review at the reduced interval. */
function relearn(card: Card, rating: Rating, now: number, p: Preset): Card {
  const steps = p.relearnSteps;
  if (steps.length === 0) return graduate(card, card.interval, now); // steps removed in Settings
  const step = Math.min(card.step, steps.length - 1);
  switch (rating) {
    case "again":
      return { ...card, step: 0, due: now + steps[0] * MINUTE };
    case "hard":
      return { ...card, step, due: now + hardDelay(steps, step) * MINUTE };
    case "good":
      if (step + 1 < steps.length) return { ...card, step: step + 1, due: now + steps[step + 1] * MINUTE };
      return graduate(card, card.interval, now);
    case "easy":
      return graduate(card, card.interval, now);
  }
}

function review(card: Card, rating: Rating, now: number, p: Preset, rng: () => number): Card {
  const I = card.interval;
  const E = card.ease;

  if (rating === "again") {
    const lapses = card.lapses + 1;
    const interval = Math.max(p.minInterval, Math.round(I * p.lapseFactor));
    const lapsed = { ...card, lapses, ease: Math.max(p.minEase, E - 0.2), interval, leech: card.leech || lapses >= p.leechLapses };
    if (p.relearnSteps.length) return { ...lapsed, phase: "relearning", step: 0, due: now + p.relearnSteps[0] * MINUTE };
    return graduate(lapsed, interval, now);
  }

  const today = studyDay(now);
  const dueDay = studyDay(card.due);
  const early = daysBetween(today, dueDay) > 0;
  let hardIvl: number, goodIvl: number, easyIvl: number;
  if (!early) {
    // Answered on time or late: late days count, partly (Anki v2).
    const late = Math.max(0, daysBetween(dueDay, today));
    hardIvl = constrain((I + Math.floor(late / 4)) * p.hardFactor, I + 1, p, rng);
    goodIvl = constrain((I + Math.floor(late / 2)) * E, hardIvl + 1, p, rng);
    easyIvl = constrain((I + late) * E * p.easyBonus, goodIvl + 1, p, rng);
  } else {
    // Answered before it was due (e.g. in a chapter quiz): grow from the days actually
    // elapsed, and never shorten the current interval.
    const elapsed = card.lastReview === null ? I : Math.max(1, daysBetween(studyDay(card.lastReview), today));
    hardIvl = constrain(elapsed * p.hardFactor, I, p, rng);
    goodIvl = constrain(elapsed * E, Math.max(I, hardIvl), p, rng);
    easyIvl = constrain(elapsed * E * p.easyBonus, goodIvl + 1, p, rng);
  }
  const interval = { hard: hardIvl, good: goodIvl, easy: easyIvl }[rating];
  const ease = rating === "hard" ? Math.max(p.minEase, E - 0.15) : rating === "easy" ? E + 0.15 : E;
  return { ...card, phase: "review", step: 0, ease, interval, due: reviewDue(now, interval) };
}

export const sm2: Scheduler = {
  next(card, rating, now, p) {
    // Fuzz is seeded by card and repetition, so a preview and the real answer agree.
    const rng = makeRng(hashString(`${card.id}:${card.reps}`));
    const after =
      card.phase === "new" || card.phase === "learning"
        ? learn(card, rating, now, p)
        : card.phase === "relearning"
          ? relearn(card, rating, now, p)
          : review(card, rating, now, p, rng);
    return { ...after, reps: card.reps + 1, lastReview: now, lastRating: rating, updatedAt: now };
  },
};
