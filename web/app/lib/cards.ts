// Cards as the server schedules them (server/src/recall_engine), and how the app shows them.
// The app never schedules: ratings go to the API, which answers with the new card.

import { studyDay } from "./dates";

export type Rating = "again" | "hard" | "good" | "easy";
export const RATINGS: Rating[] = ["again", "hard", "good", "easy"];

export type CardKind = "question" | "exercise";

export type CardPhase = "new" | "learning" | "review" | "relearning";

/** Scheduling state for one card. Keyed by the content item's id (unique across a subject). */
export interface Card {
  id: string;
  kind: CardKind;
  phase: CardPhase;
  /** Index into the learning / relearning steps. */
  step: number;
  /** Epoch ms. Learning cards: an exact moment. Review cards: the start of their due study day. */
  due: number;
  /** Days. For relearning cards, the interval they return to review with. */
  interval: number;
  /** Multiplier, 2.5 = 250%. */
  ease: number;
  reps: number;
  lapses: number;
  lastReview: number | null;
  lastRating: Rating | null;
  leech: boolean;
  suspended: boolean;
  /** Epoch ms of the last change; merges keep the newer card. */
  updatedAt: number;
}

/** Durations in minutes (learning steps). */
export type Minutes = number;

/** Per-kind scheduling knobs — what Anki calls deck options. */
export interface Preset {
  learnSteps: Minutes[];
  relearnSteps: Minutes[];
  graduatingInterval: number;
  easyInterval: number;
  startingEase: number;
  hardFactor: number;
  easyBonus: number;
  intervalModifier: number;
  /** Multiplier applied to the interval on a lapse (0 = back to the minimum). */
  lapseFactor: number;
  minInterval: number;
  maxInterval: number;
  minEase: number;
  fuzz: boolean;
  newPerDay: number;
  reviewsPerDay: number;
  /** Lapses at which a card is tagged as a leech. */
  leechLapses: number;
  /** How far ahead (minutes) a session may show learning cards that aren't due yet. */
  learnAheadMinutes: number;
}

/** The learner's changes to the default presets (Settings › Scheduling). */
export type PresetOverrides = Partial<Record<CardKind, Partial<Preset>>>;

export function formatDue(after: Card, now: number): string {
  if (after.phase === "review") return formatDays(after.interval);
  return formatWait(after.due - now);
}

/** A wait in ms as "<1m", "6m", "3h" or days. */
export function formatWait(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  return formatDays(Math.round(mins / (24 * 60)));
}

export function formatDays(days: number): string {
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.round((days / 30) * 10) / 10}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}

export function isDue(card: Card | undefined, now: number): boolean {
  return !!card && !card.suspended && card.phase !== "new" && card.due <= now;
}

/** Anki calls a card "mature" at a 21-day interval; that's our "mastered". */
export const MATURE_DAYS = 21;
export const isMastered = (card: Card | undefined) => !!card && card.phase === "review" && card.interval >= MATURE_DAYS;

/** The due study day of a card (review cards), for forecasts. */
export const dueDay = (card: Card) => studyDay(card.due);

// ---- learning steps, as typed in Settings -------------------------------------------

const UNIT: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 24 * 60 };

/** Parse Anki-style steps, "1m 10m 1d" (bare numbers are minutes). Null when invalid. */
export function parseSteps(input: string): Minutes[] | null {
  const parts = input.trim().split(/[\s,]+/).filter(Boolean);
  const out: Minutes[] = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(p);
    if (!m) return null;
    const mins = Number(m[1]) * UNIT[(m[2] || "m").toLowerCase()];
    if (!(mins > 0)) return null;
    out.push(mins);
  }
  return out;
}

export function formatSteps(steps: Minutes[]): string {
  return steps
    .map((m) => (m % (24 * 60) === 0 ? `${m / (24 * 60)}d` : m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${m}m`))
    .join(" ");
}
