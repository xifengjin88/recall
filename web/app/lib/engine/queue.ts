// The TS copy of today's queue. The app now asks the server (POST /queue); this remains only for
// scripts/gen-engine-golden.test.ts, which generated the Python engine's golden cases. Removed in T25.

import { dayStartMs, studyDay } from "../dates";
import type { ReviewRecord } from "../progress";
import type { TodayQueue } from "../session";
import { isDue, type Card, type CardKind, type Preset } from ".";

export interface DoneToday {
  newDone: number;
  reviewsDone: number;
}

/** New cards introduced and reviews done so far this study day, per card kind. */
export function doneToday(reviews: ReviewRecord[], now: number): Record<CardKind, DoneToday> {
  const out: Record<CardKind, DoneToday> = { question: { newDone: 0, reviewsDone: 0 }, exercise: { newDone: 0, reviewsDone: 0 } };
  const start = dayStartMs(studyDay(now));
  for (const r of reviews) {
    if (r.at < start) continue;
    if (r.before.phase === "new") out[r.kind].newDone++;
    else if (r.before.phase === "review") out[r.kind].reviewsDone++;
  }
  return out;
}

/** Anki's queue for one card kind. `candidates` are the active item ids in study order. */
export function todayQueue(
  candidates: string[],
  cards: Record<string, Card>,
  now: number,
  preset: Preset,
  done: DoneToday,
  learnAhead = true,
): TodayQueue {
  const horizon = now + (learnAhead ? preset.learnAheadMinutes * 60_000 : 0);
  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: string[] = [];
  for (const id of candidates) {
    const c = cards[id];
    if (!c || c.phase === "new") {
      if (!c?.suspended) fresh.push(id);
    } else if (c.suspended) {
      continue;
    } else if (c.phase === "review") {
      if (isDue(c, now)) review.push(c);
    } else if (c.due <= horizon) {
      learning.push(c);
    }
  }
  const byDue = (a: Card, b: Card) => a.due - b.due;
  return {
    learning: learning.sort(byDue).map((c) => c.id),
    review: review.sort(byDue).slice(0, Math.max(0, preset.reviewsPerDay - done.reviewsDone)).map((c) => c.id),
    fresh: fresh.slice(0, Math.max(0, preset.newPerDay - done.newDone)),
  };
}
