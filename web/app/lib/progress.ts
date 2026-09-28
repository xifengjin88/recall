import { dayStartMs } from "./dates";
import type { Card, CardKind, CardPhase, PresetOverrides, Rating } from "./cards";
import type { QuestionType } from "./types";

export type SessionMode = "quiz" | "flashcards" | "exercise";
export type ReviewSource = "quiz" | "flashcard" | "exercise";

/** The scheduling-relevant part of a card, recorded before and after each review. */
export interface CardSnapshot {
  phase: CardPhase;
  interval: number;
  ease: number;
  due: number;
}

export const snapshot = (c: Card): CardSnapshot => ({ phase: c.phase, interval: c.interval, ease: c.ease, due: c.due });

/** One rating of one card, from any source. Append-only (an override rewrites its own entry). */
export interface ReviewRecord {
  id: string;
  cardId: string;
  kind: CardKind;
  source: ReviewSource;
  sessionId: string | null;
  at: number;
  rating: Rating;
  /** Quiz: graded correct (incl. override). Flashcards/exercises: rating isn't "again". */
  correct: boolean;
  /** The learner's answer as display text. */
  answer: string;
  hinted: boolean;
  overridden: boolean;
  before: CardSnapshot;
  after: CardSnapshot;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface SessionRecord {
  id: string;
  mode: SessionMode;
  startedAt: number;
  /** Set when the learner reaches the summary; only completed sessions count for streaks. */
  completedAt?: number;
  completedDay?: string;
}

export type ExerciseStatus = "not-started" | "in-progress" | "done" | "skipped";
/** first = the initial attempt; redo = a full redo when due; quick = sketch the approach, then rate. */
export type AttemptMode = "first" | "redo" | "quick";

export interface ExerciseState {
  status: ExerciseStatus;
  /** Kept across attempts. */
  notes: string;
  /** The current attempt. */
  attempt: AttemptMode;
  attemptStartedAt: number | null;
  testsPassed: string[];
  hintsRevealed: number;
  updatedAt: number;
}

export const NEW_EXERCISE: ExerciseState = {
  status: "not-started",
  notes: "",
  attempt: "first",
  attemptStartedAt: null,
  testsPassed: [],
  hintsRevealed: 0,
  updatedAt: 0,
};

export type Theme = "system" | "light" | "dark";
export type SessionLength = 10 | 20 | "all";
export type SessionOrder = "shuffled" | "book";

export interface Settings {
  theme: Theme;
  showKeyHints: boolean;
  /** Only the options the learner changed; everything else uses the engine's defaults. */
  scheduling: PresetOverrides;
  /** The learner's IANA time zone, for day boundaries (the server's copy; the browser reports it). */
  timeZone?: string;
}

/** Session setup choices, remembered between sessions (spec §3.3). */
export interface SessionPrefs {
  length: SessionLength;
  order: SessionOrder;
  types: QuestionType[]; // empty = all
  difficulty: 0 | 1 | 2 | 3; // 0 = any
}

export interface ProgressData {
  version: 2;
  cards: Record<string, Card>;
  reviews: ReviewRecord[];
  sessions: SessionRecord[];
  exercises: Record<string, ExerciseState>;
  settings: Settings;
  prefs: SessionPrefs;
  lastChapter: number | null;
}

export const DEFAULT_SETTINGS: Settings = { theme: "system", showKeyHints: true, scheduling: {} };
export const DEFAULT_PREFS: SessionPrefs = { length: 10, order: "shuffled", types: [], difficulty: 0 };

export function emptyProgress(): ProgressData {
  return {
    version: 2,
    cards: {},
    reviews: [],
    sessions: [],
    exercises: {},
    settings: { ...DEFAULT_SETTINGS, scheduling: {} },
    prefs: { ...DEFAULT_PREFS, types: [] },
    lastChapter: null,
  };
}

// ---- export / import ------------------------------------------------------------

/** Export files are tagged with the app and subject they came from. */
export const EXPORT_APP = "recall";
const LEGACY_EXPORT_APPS = ["tlpi-drill"];

export function exportProgress(p: ProgressData, subject: string, now = new Date()): string {
  return JSON.stringify({ app: EXPORT_APP, subject, version: 2, exportedAt: now.toISOString(), data: p }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parse stored or imported progress (v2, or v1 which is migrated). Null when unrecognisable. */
export function parseProgress(raw: unknown): ProgressData | null {
  const wrapped = isObj(raw) && isObj(raw.data) && (raw.app === EXPORT_APP || LEGACY_EXPORT_APPS.includes(String(raw.app)));
  const v = wrapped ? (raw as { data: unknown }).data : raw;
  if (!isObj(v)) return null;
  if (v.version === 1) return migrateV1(v);
  if (v.version !== 2 || !isObj(v.cards) || !Array.isArray(v.reviews)) return null;
  return {
    version: 2,
    cards: v.cards as ProgressData["cards"],
    reviews: v.reviews as ReviewRecord[],
    sessions: Array.isArray(v.sessions) ? (v.sessions as SessionRecord[]) : [],
    exercises: isObj(v.exercises) ? (v.exercises as ProgressData["exercises"]) : {},
    settings: parseSettings(v.settings),
    prefs: { ...DEFAULT_PREFS, types: [], ...(isObj(v.prefs) ? v.prefs : {}) },
    lastChapter: typeof v.lastChapter === "number" ? v.lastChapter : null,
  };
}

function parseSettings(raw: unknown): Settings {
  const s = isObj(raw) ? raw : {};
  return {
    theme: s.theme === "light" || s.theme === "dark" ? s.theme : "system",
    showKeyHints: s.showKeyHints !== false,
    scheduling: isObj(s.scheduling) ? (s.scheduling as PresetOverrides) : {},
  };
}

// ---- v1 (Leitner boxes) -> v2 (cards) -------------------------------------------

const V1_INTERVALS = [0, 1, 3, 7, 16, 35];

interface V1Item {
  box: number;
  due: string | null;
  mistake: boolean;
  updatedAt: number;
}
interface V1Attempt {
  id: string;
  questionId: string;
  sessionId: string;
  mode: "quiz" | "flashcards";
  at: number;
  correct: boolean;
  hinted: boolean;
  overridden: boolean;
  answer: string;
  rating?: Rating;
  boxBefore: number;
  boxAfter: number;
}
interface V1Exercise {
  status: ExerciseStatus;
  testsPassed?: string[];
  hintsRevealed?: number;
  notes?: string;
  updatedAt?: number;
}

const v1Snapshot = (box: number): CardSnapshot => ({ phase: box ? "review" : "new", interval: V1_INTERVALS[box] ?? 0, ease: 2.5, due: 0 });

/** Boxes become review cards at the box's interval (ease 250%); attempts become reviews. */
export function migrateV1(v1: Record<string, unknown>): ProgressData {
  const out = emptyProgress();
  const items = (isObj(v1.items) ? v1.items : {}) as Record<string, V1Item>;
  const attempts = (Array.isArray(v1.attempts) ? v1.attempts : []) as V1Attempt[];

  for (const [id, it] of Object.entries(items)) {
    if (!it || !it.box) continue;
    out.cards[id] = {
      id,
      kind: "question",
      phase: "review",
      step: 0,
      due: it.due ? dayStartMs(it.due) : 0,
      interval: V1_INTERVALS[it.box] ?? 1,
      ease: 2.5,
      reps: attempts.filter((a) => a.questionId === id).length,
      lapses: 0,
      lastReview: it.updatedAt || null,
      lastRating: it.mistake ? "again" : "good",
      leech: false,
      suspended: false,
      updatedAt: it.updatedAt || 0,
    };
  }

  out.reviews = attempts.map((a) => ({
    id: a.id,
    cardId: a.questionId,
    kind: "question" as const,
    source: a.mode === "flashcards" ? ("flashcard" as const) : ("quiz" as const),
    sessionId: a.sessionId,
    at: a.at,
    rating: a.rating ?? (!a.correct ? "again" : a.hinted || a.overridden ? "hard" : "good"),
    correct: a.correct,
    answer: a.answer,
    hinted: a.hinted,
    overridden: a.overridden,
    before: v1Snapshot(a.boxBefore),
    after: v1Snapshot(a.boxAfter),
  }));

  out.sessions = Array.isArray(v1.sessions) ? (v1.sessions as SessionRecord[]) : [];
  for (const [id, e] of Object.entries((isObj(v1.exercises) ? v1.exercises : {}) as Record<string, V1Exercise>)) {
    out.exercises[id] = {
      ...NEW_EXERCISE,
      status: e.status,
      notes: e.notes ?? "",
      testsPassed: e.testsPassed ?? [],
      hintsRevealed: e.hintsRevealed ?? 0,
      updatedAt: e.updatedAt ?? 0,
    };
  }
  if (isObj(v1.settings)) {
    out.settings = { ...out.settings, theme: (v1.settings.theme as Theme) ?? "system", showKeyHints: v1.settings.showKeyHints !== false };
  }
  if (isObj(v1.prefs)) out.prefs = { ...out.prefs, ...(v1.prefs as Partial<SessionPrefs>) };
  if (typeof v1.lastChapter === "number") out.lastChapter = v1.lastChapter;
  return out;
}

// ---- merge / reset --------------------------------------------------------------

function newerById<T extends { updatedAt: number }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const out = { ...a };
  for (const [id, rec] of Object.entries(b)) if (!out[id] || rec.updatedAt > out[id].updatedAt) out[id] = rec;
  return out;
}

function unionById<T extends { id: string }>(a: T[], b: T[], prefer: (x: T, y: T) => T = (x) => x): T[] {
  const map = new Map(a.map((x) => [x.id, x]));
  for (const y of b) {
    const x = map.get(y.id);
    map.set(y.id, x ? prefer(x, y) : y);
  }
  return [...map.values()];
}

/** Merge an import into current progress, keeping the most recent record per item (spec §7). */
export function mergeProgress(current: ProgressData, incoming: ProgressData): ProgressData {
  return {
    ...current,
    cards: newerById(current.cards, incoming.cards),
    exercises: newerById(current.exercises, incoming.exercises),
    reviews: unionById(current.reviews, incoming.reviews).sort((x, y) => x.at - y.at),
    sessions: unionById(current.sessions, incoming.sessions, (x, y) => (x.completedAt ? x : y)).sort((x, y) => x.startedAt - y.startedAt),
  };
}

/** Drop all progress for the given item ids (a chapter reset). Settings are kept. */
export function resetItems(p: ProgressData, ids: Set<string>): ProgressData {
  const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => !ids.has(id)));
  return { ...p, cards: keep(p.cards), exercises: keep(p.exercises), reviews: p.reviews.filter((r) => !ids.has(r.cardId)) };
}

export function resetAll(p: ProgressData): ProgressData {
  return { ...emptyProgress(), settings: p.settings, prefs: p.prefs };
}
