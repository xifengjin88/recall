import { studyDay } from "../dates";
import { PRESETS } from "./presets";
import { newCard, sm2 } from "./sm2";
import { RATINGS, type Card, type CardKind, type Preset, type Rating, type Scheduler } from "./types";

export * from "./types";
export { PRESETS, QUESTION_PRESET, EXERCISE_PRESET } from "./presets";
export { newCard } from "./sm2";
export { makeRng, hashString } from "./rng";
export { parseSteps, formatSteps } from "./steps";

/** The learner's changes to the default presets (Settings › Scheduling). */
export type PresetOverrides = Partial<Record<CardKind, Partial<Preset>>>;

export function resolvePreset(kind: CardKind, overrides?: PresetOverrides): Preset {
  return { ...PRESETS[kind], ...(overrides?.[kind] ?? {}) };
}

/** The active scheduler. Swap for another implementation (e.g. FSRS) here. */
export const scheduler: Scheduler = sm2;

export function cardFor(cards: Record<string, Card>, id: string, kind: CardKind, overrides?: PresetOverrides): Card {
  return cards[id] ?? newCard(id, kind, resolvePreset(kind, overrides));
}

export function answer(card: Card, rating: Rating, now: number, preset: Preset = PRESETS[card.kind]): Card {
  return scheduler.next(card, rating, now, preset);
}

/** What each rating would do, for labelling buttons ("<1m", "10m", "4d"). */
export function preview(card: Card, now: number, preset: Preset = PRESETS[card.kind]): Record<Rating, Card> {
  return Object.fromEntries(RATINGS.map((r) => [r, answer(card, r, now, preset)])) as Record<Rating, Card>;
}

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
