// The scheduling engine knows about cards and ratings only, never about questions or
// exercises. Content maps onto it through a card `kind` and that kind's preset.

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

export interface Scheduler {
  /** The card after answering it with `rating` at `now`. Pure. */
  next(card: Card, rating: Rating, now: number, preset: Preset): Card;
}
