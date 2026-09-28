// The current course's progress, backed by the API (SPEC-web-client.md).
//
// The server schedules: recordReview / overrideReview / previewCard await the API and use the
// cards it returns. Other changes update memory at once and are sent in order in the background;
// a failure shows the "Couldn't save" notice. Exercise state, settings and prefs are still
// memory-only here until their endpoints land (T22, T23).

import { useSyncExternalStore } from "react";
import { api } from "~/api/client";
import type { Previews, ReviewResult } from "~/api/types";
import { APP } from "~/config";
import { resolvePreset, type Card, type CardKind, type Preset, type Rating } from "~/lib/engine";
import {
  emptyProgress,
  NEW_EXERCISE,
  type AttemptMode,
  type ExerciseState,
  type ProgressData,
  type ReviewSource,
  type SessionMode,
  type SessionPrefs,
  type Settings,
} from "~/lib/progress";

/** The theme is mirrored here so the pre-paint script in root.tsx can read it synchronously. */
export const THEME_KEY = `${APP.id}:theme`;

/** The IndexedDB database that held a course's progress before the server (see migrate-local.ts). */
export const courseDbName = (slug: string) => `${APP.id}-${slug}`;

export type Notice = "migrated" | "save-failed" | null;

export interface StoreStatus {
  ready: boolean;
  notice: Notice;
}

// Pre-rendering (SPA shell at build time) and the first client render read these constants.
const SERVER_SNAPSHOT = emptyProgress();
const SERVER_STATUS: StoreStatus = { ready: false, notice: null };

let course: string | null = null;
let loading: Promise<void> | null = null;
let state: ProgressData = SERVER_SNAPSHOT;
let status: StoreStatus = SERVER_STATUS;
let writes: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const setStatus = (patch: Partial<StoreStatus>) => {
  status = { ...status, ...patch };
  emit();
};
const set = (next: ProgressData) => {
  state = next;
  emit();
};

function mirrorTheme(theme: Settings["theme"]) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // best effort
  }
}

function requireCourse(): string {
  if (!course) throw new Error("No course loaded");
  return course;
}

/** Send a change in the background, after any earlier ones. */
function send(call: () => Promise<unknown>) {
  writes = writes.then(call).catch(() => setStatus({ notice: "save-failed" }));
}

/** Load a course's progress from the server. Safe to call repeatedly; switching course reloads. */
export function loadCourseProgress(slug: string): Promise<void> {
  if (loading && course === slug) return loading;
  course = slug;
  state = SERVER_SNAPSHOT;
  status = SERVER_STATUS;
  const promise = (async () => {
    const data = await api.progress(slug);
    if (course !== slug) return; // switched away meanwhile
    state = data;
    mirrorTheme(data.settings.theme);
    status = { ready: true, notice: status.notice };
    emit();
  })();
  loading = promise;
  promise.catch(() => {
    if (loading === promise) loading = null;
  });
  return promise;
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
export const showNotice = (notice: Notice) => setStatus({ notice });

/** Read without subscribing (e.g. when building a session once). */
export const getProgress = () => state;
export const getStatus = () => status;
/** Resolves when every background change has been sent. */
export const flushWrites = () => writes;

export function presetFor(kind: CardKind): Preset {
  return resolvePreset(kind, state.settings.scheduling);
}

// ---- sessions ---------------------------------------------------------------------

export function startSession(id: string, mode: SessionMode) {
  if (state.sessions.some((s) => s.id === id)) return;
  set({ ...state, sessions: [...state.sessions, { id, mode, startedAt: Date.now() }] });
  const slug = requireCourse();
  send(() => api.startSession(slug, id, mode));
}

export function completeSession(id: string) {
  const slug = requireCourse();
  // The server decides completedDay (the learner's study day); memory updates when it answers.
  send(async () => {
    const done = await api.completeSession(slug, id);
    if (course === slug) set({ ...state, sessions: state.sessions.map((s) => (s.id === id ? done : s)) });
  });
}

// ---- reviews (scheduled by the server) --------------------------------------------

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
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface Reviewed {
  before: Card;
  after: Card;
}

function applyResult({ review, card }: ReviewResult): Reviewed {
  set({
    ...state,
    cards: { ...state.cards, [card.id]: card },
    reviews: [...state.reviews.filter((r) => r.id !== review.id), review],
  });
  return { before: review.before, after: card };
}

async function withSaveNotice<T>(call: () => Promise<T>): Promise<T> {
  await writes; // keep ordering with earlier background changes (e.g. the session start)
  try {
    return await call();
  } catch (err) {
    setStatus({ notice: "save-failed" });
    throw err;
  }
}

/** Rate a card. Resolves with the card as it was and as the server scheduled it. */
export function recordReview(input: ReviewInput): Promise<Reviewed> {
  const slug = requireCourse();
  return withSaveNotice(async () =>
    applyResult(
      await api.review(slug, {
        id: input.reviewId,
        itemKey: input.cardId,
        source: input.source,
        sessionId: input.sessionId,
        rating: input.rating,
        correct: input.correct,
        answer: input.answer,
        hinted: input.hinted,
        durationMs: input.durationMs,
        meta: input.meta,
      }),
    ),
  );
}

/** "I was right": the server re-rates the review as Hard from the card before it. */
export function overrideReview(reviewId: string): Promise<Reviewed> {
  const slug = requireCourse();
  return withSaveNotice(async () => applyResult(await api.overrideReview(slug, reviewId)));
}

/** What each rating would schedule, for button labels. */
export function previewCard(itemKey: string): Promise<Previews> {
  return api.preview(requireCourse(), itemKey);
}

export function setSuspended(cardId: string, _kind: CardKind, suspended: boolean) {
  const slug = requireCourse();
  const current = state.cards[cardId];
  if (current) set({ ...state, cards: { ...state.cards, [cardId]: { ...current, suspended } } });
  send(async () => {
    const card = await api.patchCard(slug, cardId, { suspended });
    if (course === slug) set({ ...state, cards: { ...state.cards, [card.id]: card } });
  });
}

// ---- exercises (memory-only until T22) ---------------------------------------------

function putExercise(id: string, next: ExerciseState) {
  set({ ...state, exercises: { ...state.exercises, [id]: next } });
}

export function updateExercise(id: string, patch: Partial<Omit<ExerciseState, "updatedAt">>) {
  const prev = state.exercises[id] ?? NEW_EXERCISE;
  const next: ExerciseState = { ...prev, ...patch, updatedAt: Date.now() };
  if (!patch.status && next.status === "not-started") next.status = "in-progress";
  if (next.attemptStartedAt === null && next.status === "in-progress") next.attemptStartedAt = Date.now();
  putExercise(id, next);
}

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

// ---- settings (memory-only until T23) ---------------------------------------------

export function updateSettings(patch: Partial<Settings>) {
  if (patch.theme) mirrorTheme(patch.theme);
  set({ ...state, settings: { ...state.settings, ...patch } });
}

/** Change one kind's scheduling options; `null` resets that kind to the defaults. */
export function updateScheduling(kind: CardKind, patch: Partial<Preset> | null) {
  const scheduling = { ...state.settings.scheduling };
  if (patch === null) delete scheduling[kind];
  else scheduling[kind] = { ...(scheduling[kind] ?? {}), ...patch };
  updateSettings({ scheduling });
}

export function updatePrefs(patch: Partial<SessionPrefs>) {
  set({ ...state, prefs: { ...state.prefs, ...patch } });
}

export function setLastChapter(n: number) {
  if (state.lastChapter !== n) set({ ...state, lastChapter: n });
}

// ---- import / reset ----------------------------------------------------------------

/** Import an export file (the server accepts current and old formats). Resolves with the skipped count. */
export async function importProgress(file: unknown, mode: "replace" | "merge"): Promise<number> {
  const slug = requireCourse();
  const result = await withSaveNotice(() => api.importProgress(slug, mode, file));
  mirrorTheme(result.progress.settings.theme);
  set(result.progress);
  return result.skipped;
}

export async function exportProgress(): Promise<unknown> {
  return api.exportProgress(requireCourse());
}

/** Reset one unit's progress (`unit`), or all of this course's. Settings are kept. */
export async function resetProgress(unit?: number) {
  const slug = requireCourse();
  set(await withSaveNotice(() => api.resetProgress(slug, unit)));
}

/** Test hook: forget the loaded course. */
export function __resetStoreForTests() {
  course = null;
  loading = null;
  state = SERVER_SNAPSHOT;
  status = SERVER_STATUS;
  writes = Promise.resolve();
}
