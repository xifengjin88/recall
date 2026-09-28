import { useSyncExternalStore } from "react";
import { APP } from "~/config";

import { today } from "~/lib/dates";
import { answer, cardFor, resolvePreset, type Card, type CardKind, type Preset, type Rating } from "~/lib/engine";
import {
  emptyProgress,
  mergeProgress,
  NEW_EXERCISE,
  parseProgress,
  resetAll,
  snapshot,
  type AttemptMode,
  type ExerciseState,
  type ProgressData,
  type ReviewRecord,
  type ReviewSource,
  type SessionMode,
  type SessionPrefs,
  type Settings,
} from "~/lib/progress";
import { IdbRepo } from "./idb-repo";
import { MemoryRepo, type Changes, type ProgressRepo } from "./repo";

/** Where v1 kept everything, before IndexedDB. Migrated once, then renamed as a backup. */
const LEGACY_KEY = "tlpi-drill:progress";
/** The course that pre-course-era progress belongs to. */
const LEGACY_COURSE = "tlpi";
/** The theme is mirrored here so the pre-paint script in root.tsx can read it synchronously. */
export const THEME_KEY = `${APP.id}:theme`;

export type Notice = "migrated" | "no-storage" | "save-failed" | null;

export interface StoreStatus {
  ready: boolean;
  notice: Notice;
}

// Pre-rendering (SPA shell at build time) and the first client render read these constants.
const SERVER_SNAPSHOT = emptyProgress();
const SERVER_STATUS: StoreStatus = { ready: false, notice: null };

let repo: ProgressRepo = new MemoryRepo();
let state: ProgressData = SERVER_SNAPSHOT;
let status: StoreStatus = SERVER_STATUS;
let initPromise: Promise<void> | null = null;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const setStatus = (patch: Partial<StoreStatus>) => {
  status = { ...status, ...patch };
  emit();
};

function readLegacy(): ProgressData | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? parseProgress(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function mirrorTheme(theme: Settings["theme"]) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // best effort
  }
}

/** The IndexedDB database holding one course's progress. */
export const courseDbName = (slug: string) => `${APP.id}-${slug}`;

let currentDb: string | null = null;

/**
 * Load a course's progress from its IndexedDB database (moving any old localStorage
 * progress into TLPI's first). Safe to call repeatedly; switching course reloads.
 */
export function initProgress(dbName: string): Promise<void> {
  if (initPromise && currentDb === dbName) return initPromise;
  currentDb = dbName;
  state = SERVER_SNAPSHOT;
  status = SERVER_STATUS;
  initPromise = (async () => {
    let notice: Notice = null;
    try {
      const idb = new IdbRepo(dbName);
      let data = await idb.load();
      if (!data && dbName === courseDbName(LEGACY_COURSE)) {
        const legacy = readLegacy();
        if (legacy) {
          await idb.replaceAll(legacy);
          try {
            localStorage.setItem(`${LEGACY_KEY}:migrated-to-indexeddb`, localStorage.getItem(LEGACY_KEY) ?? "");
            localStorage.removeItem(LEGACY_KEY);
          } catch {
            // the copy in IndexedDB is what matters
          }
          data = legacy;
          notice = "migrated";
        }
      }
      repo = idb;
      state = data ?? emptyProgress();
      // Ask the browser not to evict our data under storage pressure.
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      repo = new MemoryRepo();
      state = emptyProgress();
      notice = "no-storage";
    }
    mirrorTheme(state.settings.theme);
    status = { ready: true, notice };
    emit();
  })();
  return initPromise;
}

/** Apply a change in memory now, and persist it in the background (in order). */
function commit(update: (p: ProgressData) => ProgressData, changes: (p: ProgressData) => Changes) {
  state = update(state);
  const c = changes(state);
  emit();
  const target = repo; // this course's database, even if the learner switches course before it runs
  writes = writes.then(() => target.commit(c)).catch(() => setStatus({ notice: "save-failed" }));
}

function replace(next: ProgressData) {
  state = next;
  emit();
  const target = repo;
  writes = writes.then(() => target.replaceAll(next)).catch(() => setStatus({ notice: "save-failed" }));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useProgress(): ProgressData {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_SNAPSHOT);
}

export function useStoreStatus(): StoreStatus {
  return useSyncExternalStore(subscribe, () => status, () => SERVER_STATUS);
}

export const dismissNotice = () => setStatus({ notice: null });

/** Read without subscribing (e.g. when building a session once). */
export const getProgress = () => state;
/** Resolves when every pending write has reached storage. */
export const flushWrites = () => writes;
export const storageName = () => repo.name;

export function presetFor(kind: CardKind): Preset {
  return resolvePreset(kind, state.settings.scheduling);
}

// ---- sessions ---------------------------------------------------------------------

export function startSession(id: string, mode: SessionMode) {
  if (state.sessions.some((s) => s.id === id)) return;
  const session = { id, mode, startedAt: Date.now() };
  commit((p) => ({ ...p, sessions: [...p.sessions, session] }), () => ({ sessions: [session] }));
}

export function completeSession(id: string) {
  const s = state.sessions.find((x) => x.id === id);
  if (!s || s.completedAt) return;
  const done = { ...s, completedAt: Date.now(), completedDay: today() };
  commit((p) => ({ ...p, sessions: p.sessions.map((x) => (x.id === id ? done : x)) }), () => ({ sessions: [done] }));
}

// ---- reviews ----------------------------------------------------------------------

export interface ReviewInput {
  reviewId: string;
  cardId: string;
  kind: CardKind;
  source: ReviewSource;
  sessionId: string | null;
  rating: Rating;
  correct: boolean;
  answer: string;
  hinted?: boolean;
  overridden?: boolean;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface Reviewed {
  before: Card;
  after: Card;
}

/** Rate a card (from any source) and log it. */
export function recordReview(input: ReviewInput): Reviewed {
  const now = Date.now();
  const before = cardFor(state.cards, input.cardId, input.kind, state.settings.scheduling);
  const after = answer(before, input.rating, now, presetFor(input.kind));
  const review: ReviewRecord = {
    id: input.reviewId,
    cardId: input.cardId,
    kind: input.kind,
    source: input.source,
    sessionId: input.sessionId,
    at: now,
    rating: input.rating,
    correct: input.correct,
    answer: input.answer,
    hinted: !!input.hinted,
    overridden: !!input.overridden,
    before: snapshot(before),
    after: snapshot(after),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  };
  commit(
    (p) => ({ ...p, cards: { ...p.cards, [after.id]: after }, reviews: [...p.reviews, review] }),
    () => ({ cards: [after], reviews: [review] }),
  );
  return { before, after };
}

/** "I was right": re-rate a review as Hard (correct by override), from the card as it was before. */
export function overrideReview(reviewId: string, before: Card): Reviewed {
  const now = Date.now();
  const after = answer(before, "hard", now, presetFor(before.kind));
  const old = state.reviews.find((r) => r.id === reviewId);
  if (!old) return { before, after: state.cards[before.id] ?? before };
  const review: ReviewRecord = { ...old, rating: "hard", correct: true, overridden: true, after: snapshot(after) };
  commit(
    (p) => ({ ...p, cards: { ...p.cards, [after.id]: after }, reviews: p.reviews.map((r) => (r.id === reviewId ? review : r)) }),
    () => ({ cards: [after], reviews: [review] }),
  );
  return { before, after };
}

export function setSuspended(cardId: string, kind: CardKind, suspended: boolean) {
  const card = { ...cardFor(state.cards, cardId, kind, state.settings.scheduling), suspended, updatedAt: Date.now() };
  commit((p) => ({ ...p, cards: { ...p.cards, [cardId]: card } }), () => ({ cards: [card] }));
}

// ---- exercises --------------------------------------------------------------------

function putExercise(id: string, next: ExerciseState) {
  commit((p) => ({ ...p, exercises: { ...p.exercises, [id]: next } }), () => ({ exercises: { [id]: next } }));
}

export function updateExercise(id: string, patch: Partial<Omit<ExerciseState, "updatedAt">>) {
  const prev = state.exercises[id] ?? NEW_EXERCISE;
  const next: ExerciseState = { ...prev, ...patch, updatedAt: Date.now() };
  // Any interaction with a not-started exercise moves it to in progress.
  if (!patch.status && next.status === "not-started") next.status = "in-progress";
  if (next.attemptStartedAt === null && next.status === "in-progress") next.attemptStartedAt = Date.now();
  putExercise(id, next);
}

/** Begin a redo (full or quick): tests and hints reset; notes are kept. */
export function startExerciseAttempt(id: string, mode: Exclude<AttemptMode, "first">) {
  const prev = state.exercises[id] ?? NEW_EXERCISE;
  putExercise(id, {
    ...prev,
    status: "in-progress",
    attempt: mode,
    attemptStartedAt: Date.now(),
    testsPassed: [],
    hintsRevealed: 0,
    updatedAt: Date.now(),
  });
}

// ---- settings ---------------------------------------------------------------------

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch };
  if (patch.theme) mirrorTheme(patch.theme);
  commit((p) => ({ ...p, settings }), () => ({ meta: { settings } }));
}

/** Change one kind's scheduling options; `null` resets that kind to the defaults. */
export function updateScheduling(kind: CardKind, patch: Partial<Preset> | null) {
  const scheduling = { ...state.settings.scheduling };
  if (patch === null) delete scheduling[kind];
  else scheduling[kind] = { ...(scheduling[kind] ?? {}), ...patch };
  updateSettings({ scheduling });
}

export function updatePrefs(patch: Partial<SessionPrefs>) {
  const prefs = { ...state.prefs, ...patch };
  commit((p) => ({ ...p, prefs }), () => ({ meta: { prefs } }));
}

export function setLastChapter(n: number) {
  if (state.lastChapter === n) return;
  commit((p) => ({ ...p, lastChapter: n }), () => ({ meta: { lastChapter: n } }));
}

// ---- import / reset ---------------------------------------------------------------

export function importProgress(incoming: ProgressData, mode: "replace" | "merge") {
  const next = mode === "replace" ? incoming : mergeProgress(state, incoming);
  mirrorTheme(next.settings.theme);
  replace(next);
}

export function resetChapterProgress(itemIds: Set<string>) {
  const ids = [...itemIds];
  commit(
    (p) => {
      const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => !itemIds.has(id)));
      return { ...p, cards: keep(p.cards), exercises: keep(p.exercises), reviews: p.reviews.filter((r) => !itemIds.has(r.cardId)) };
    },
    () => ({ deleteItems: ids }),
  );
}

export function resetAllProgress() {
  replace(resetAll(state));
}

/** Test hook: start over with a fresh store (and optionally a given repo). */
export function __resetStoreForTests(r: ProgressRepo = new MemoryRepo()) {
  repo = r;
  state = emptyProgress();
  status = { ready: true, notice: null };
  initPromise = Promise.resolve();
  writes = Promise.resolve();
}
