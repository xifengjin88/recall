import { addDays, studyDay, type Day } from "./dates";
import type { Card } from "./cards";
import type { ReviewRecord, SessionRecord } from "./progress";

/**
 * Consecutive days with a completed session, ending today. If nothing was
 * completed today yet, a streak through yesterday still counts (it isn't broken
 * until a whole day is missed).
 */
export function streak(sessions: SessionRecord[], day: Day): number {
  const days = new Set(sessions.filter((s) => s.completedDay).map((s) => s.completedDay!));
  let cur = days.has(day) ? day : addDays(day, -1);
  let n = 0;
  while (days.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}

export interface DayAccuracy {
  day: Day;
  correct: number;
  total: number;
}

export function accuracyByDay(reviews: ReviewRecord[]): DayAccuracy[] {
  const map = new Map<Day, DayAccuracy>();
  for (const r of reviews) {
    const day = studyDay(r.at);
    const row = map.get(day) ?? { day, correct: 0, total: 0 };
    row.total++;
    if (r.correct) row.correct++;
    map.set(day, row);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export interface WeakItem {
  cardId: string;
  wrong: number;
  total: number;
}

/** Cards most often answered wrong (ties: lower accuracy first). */
export function weakest(reviews: ReviewRecord[], limit = 10): WeakItem[] {
  const map = new Map<string, WeakItem>();
  for (const r of reviews) {
    const row = map.get(r.cardId) ?? { cardId: r.cardId, wrong: 0, total: 0 };
    row.total++;
    if (!r.correct) row.wrong++;
    map.set(r.cardId, row);
  }
  return [...map.values()]
    .filter((r) => r.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || b.wrong / b.total - a.wrong / a.total)
    .slice(0, limit);
}

export function studyDays(reviews: ReviewRecord[]): number {
  return new Set(reviews.map((r) => studyDay(r.at))).size;
}

/** How many review cards fall due on each of the next `days` study days (today first, incl. overdue). */
export function forecast(cards: Card[], day: Day, days = 14): { day: Day; count: number }[] {
  const rows = Array.from({ length: days }, (_, i) => ({ day: addDays(day, i), count: 0 }));
  for (const c of cards) {
    if (c.suspended || c.phase === "new") continue;
    const d = studyDay(c.due);
    const i = d <= day ? 0 : rows.findIndex((r) => r.day === d);
    if (i >= 0) rows[i].count++;
  }
  return rows;
}
