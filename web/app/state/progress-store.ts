// The current course's progress, backed by the API (SPEC-web-client.md).
//
// The server schedules: recordReview / overrideReview / previewCard await the API and use the
// cards it returns. Other changes update memory at once and are sent in order in the background;
// a failure shows the "Couldn't save" notice. Theme, key hints, prefs and the time zone are the
// learner's across courses; scheduling overrides and the last unit belong to this course.

import { useSyncExternalStore } from "react";
import { api } from "~/api/client";
import type { ExercisePatch, Previews, ReviewResult, SchedulingInfo } from "~/api/types";
import { APP } from "~/config";
import { isUploaded, localFiles, markUploaded } from "./migrate-local";
import type { Card, CardKind, Preset, Rating } from "~/lib/cards";
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

export type Notice = "migrated" | "upload-failed" | "save-failed" | null;

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
/** This course's scheduling defaults and effective options (null until loaded). */
let scheduling: SchedulingInfo | null = null;
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
  scheduling = null;
  status = SERVER_STATUS;
  const promise = (async () => {
    let [data, info] = await Promise.all([api.progress(slug), api.scheduling(slug)]);
    let notice = status.notice;
    if (!isUploaded(slug)) {
      try {
        const uploaded = await uploadLocal(slug, data);
        if (uploaded) {
          [data, info] = [uploaded, await api.scheduling(slug)];
          notice = "migrated";
        }
      } catch {
        notice = "upload-failed"; // the browser copy is untouched; the next load tries again
      }
    }
    if (course !== slug) return; // switched away meanwhile
    state = data;
    scheduling = info;
    mirrorTheme(data.settings.theme);
    status = { ready: true, notice };
    emit();
    reportTimeZone();
  })();
  loading = promise;
  promise.catch(() => {
    if (loading === promise) loading = null;
  });
  return promise;
}

/**
 * Sends progress this browser saved before the server kept it. Replaces when the server has nothing
 * for this course yet (so the browser's settings come along), merges otherwise. Null if there was none.
 */
async function uploadLocal(slug: string, current: ProgressData): Promise<ProgressData | null> {
  const files = await localFiles(slug);
  let result: ProgressData | null = null;
  let serverEmpty = !Object.keys(current.cards).length && !current.reviews.length && !current.sessions.length && !Object.keys(current.exercises).length;
  for (const file of files) {
    const imported = await api.importProgress(slug, serverEmpty ? "replace" : "merge", file);
    result = imported.progress;
    serverEmpty = false;
  }
  markUploaded(slug);
  return result;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useProgress(): ProgressData {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_SNAPSHOT);
}

export function useScheduling(): SchedulingInfo | null {
  return useSyncExternalStore(subscribe, () => scheduling, () => null);
}

export function useStoreStatus(): StoreStatus {
  return useSyncExternalStore(subscribe, () => status, () => SERVER_STATUS);
}

export const dismissNotice = () => setStatus({ notice: null });
export const showNotice = (notice: Notice) => setStatus({ notice });

/** Read without subscribing (e.g. when building a session once). */
export const getProgress = () => state;
export const getStatus = () => status;
/** Sends any notes waiting for a typing pause, then resolves when every background change has been sent. */
export function flushWrites() {
  flushNotes();
  return writes;
}

/** The options the server schedules this kind with (engine + course defaults + learner overrides). */
export function presetFor(kind: CardKind): Preset {
  if (!scheduling) throw new Error("Scheduling options aren't loaded yet (routes under /c/:course await ensureCourse).");
  return scheduling.effective[kind];
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
  // Rating an exercise attempt finishes it (the server marks it done in the same step).
  const ex = state.exercises[card.id];
  const exercises =
    review.kind === "exercise" ? { ...state.exercises, [card.id]: { ...(ex ?? NEW_EXERCISE), status: "done" as const, updatedAt: review.at } } : state.exercises;
  set({
    ...state,
    cards: { ...state.cards, [card.id]: card },
    reviews: [...state.reviews.filter((r) => r.id !== review.id), review],
    exercises,
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

// ---- exercises --------------------------------------------------------------------
// Memory changes at once (the server applies the same rules), so typing and ticking stay instant.
// Server responses aren't copied back: a slow reply would overwrite newer typing.

const NOTES_DELAY_MS = 500;
const pendingNotes = new Map<string, { notes: string; timer: ReturnType<typeof setTimeout> }>();

function putExercise(id: string, next: ExerciseState) {
  set({ ...state, exercises: { ...state.exercises, [id]: next } });
}

function sendNotes(id: string) {
  const pending = pendingNotes.get(id);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingNotes.delete(id);
  const slug = requireCourse();
  send(() => api.patchExercise(slug, id, { notes: pending.notes }));
}

/** Send notes still waiting for the typing pause (before leaving the page or checking writes). */
export function flushNotes() {
  for (const id of [...pendingNotes.keys()]) sendNotes(id);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", flushNotes);

export function updateExercise(id: string, patch: ExercisePatch) {
  const slug = requireCourse();
  const prev = state.exercises[id] ?? NEW_EXERCISE;
  const next: ExerciseState = { ...prev, ...patch, updatedAt: Date.now() };
  if (!patch.status && next.status === "not-started") next.status = "in-progress";
  if (next.attemptStartedAt === null && next.status === "in-progress") next.attemptStartedAt = Date.now();
  putExercise(id, next);
  // Skipping suspends the card (the server does both in one step).
  const card = state.cards[id];
  const skipped = next.status === "skipped";
  if (card && card.suspended !== skipped && (skipped || prev.status === "skipped")) {
    set({ ...state, cards: { ...state.cards, [id]: { ...card, suspended: skipped } } });
  }

  const { notes, ...rest } = patch;
  if (notes !== undefined) {
    clearTimeout(pendingNotes.get(id)?.timer);
    pendingNotes.set(id, { notes, timer: setTimeout(() => sendNotes(id), NOTES_DELAY_MS) });
  }
  if (Object.keys(rest).length) {
    sendNotes(id); // keep notes ahead of a status change, e.g. typing then skipping
    send(() => api.patchExercise(slug, id, rest));
  }
}

export function startExerciseAttempt(id: string, mode: Exclude<AttemptMode, "first">) {
  const slug = requireCourse();
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
  sendNotes(id);
  send(() => api.startAttempt(slug, id, mode));
}

// ---- settings ---------------------------------------------------------------------

/** The browser's IANA zone, so day boundaries (04:00) follow the learner. Sent when it differs. */
function reportTimeZone() {
  let zone: string | undefined;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return;
  }
  if (!zone || zone === state.settings.timeZone) return;
  set({ ...state, settings: { ...state.settings, timeZone: zone } });
  send(() => api.patchSettings({ timeZone: zone }));
}

export function updateSettings(patch: Partial<Pick<Settings, "theme" | "showKeyHints">>) {
  if (patch.theme) mirrorTheme(patch.theme);
  set({ ...state, settings: { ...state.settings, ...patch } });
  send(() => api.patchSettings(patch));
}

/** Change one kind's scheduling options; `null` resets that kind to the defaults. */
export function updateScheduling(kind: CardKind, patch: Partial<Preset> | null) {
  const slug = requireCourse();
  const overrides = { ...state.settings.scheduling };
  if (patch === null) delete overrides[kind];
  else overrides[kind] = { ...(overrides[kind] ?? {}), ...patch };
  set({ ...state, settings: { ...state.settings, scheduling: overrides } });
  // The server validates and answers with the new effective options; memory follows it.
  send(async () => {
    const info = await api.patchScheduling(slug, kind, patch);
    if (course !== slug) return;
    scheduling = info;
    set({ ...state, settings: { ...state.settings, scheduling: info.overrides } });
  });
}

export function updatePrefs(patch: Partial<SessionPrefs>) {
  const prefs = { ...state.prefs, ...patch };
  set({ ...state, prefs });
  send(() => api.patchSettings({ prefs }));
}

export function setLastChapter(n: number) {
  if (state.lastChapter === n) return;
  const slug = requireCourse();
  set({ ...state, lastChapter: n });
  send(() => api.setLastUnit(slug, n));
}

// ---- import / reset ----------------------------------------------------------------

/** Import an export file (the server accepts current and old formats). Resolves with the skipped count. */
export async function importProgress(file: unknown, mode: "replace" | "merge"): Promise<number> {
  const slug = requireCourse();
  const result = await withSaveNotice(() => api.importProgress(slug, mode, file));
  mirrorTheme(result.progress.settings.theme);
  set(result.progress);
  scheduling = await api.scheduling(slug).catch(() => scheduling); // a replace may bring overrides
  emit();
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
  scheduling = null;
  status = SERVER_STATUS;
  writes = Promise.resolve();
  for (const { timer } of pendingNotes.values()) clearTimeout(timer);
  pendingNotes.clear();
}
