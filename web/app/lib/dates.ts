/** Local calendar day as "YYYY-MM-DD". Due dates and streaks compare these strings. */
export type Day = string;

/**
 * A study day starts at 4am local time, like Anki, so a late-night session still
 * counts as "today" and reviews due "tomorrow" aren't released at midnight.
 */
export const DAY_ROLLOVER_HOUR = 4;

export function toDay(d: Date): Day {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The study day a moment belongs to (shifted back by the rollover hour). */
export function studyDay(ms: number): Day {
  const d = new Date(ms);
  d.setHours(d.getHours() - DAY_ROLLOVER_HOUR);
  return toDay(d);
}

export function today(now: number = Date.now()): Day {
  return studyDay(now);
}

function parseDay(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** When a study day begins: 4am local on that date. */
export function dayStartMs(day: Day): number {
  const d = parseDay(day);
  d.setHours(DAY_ROLLOVER_HOUR, 0, 0, 0);
  return d.getTime();
}

export function addDays(day: Day, n: number): Day {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

export function formatDay(day: Day): string {
  return parseDay(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
