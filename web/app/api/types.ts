// Response shapes of the Flask API (server/src/recall_api). Hand-written; kept honest by
// contract.ts, which type-checks real responses saved by server/tests/api/test_samples.py.

import type { Card, CardKind, Preset, PresetOverrides, Rating } from "~/lib/cards";
import type { ExerciseState, ProgressData, ReviewRecord, ReviewSource, SessionPrefs, Theme } from "~/lib/progress";
import type { TodayQueue } from "~/lib/session";
import type { Chapter } from "~/lib/types";

export interface CourseSummary {
  slug: string;
  title: string;
  short: string;
  author: string | null;
  description: string | null;
  unitCount: number;
  questionCount: number;
  exerciseCount: number;
  /** Questions in today's queue (the course home's counts). */
  today: { learning: number; review: number; fresh: number };
}

export interface CoursesResponse {
  courses: CourseSummary[];
}

export interface OutlineEntry {
  number: number;
  title: string;
  hasContent: boolean;
  hasNotes: boolean;
}

export interface CourseOutline {
  slug: string;
  title: string;
  short: string;
  author: string | null;
  description: string | null;
  contentHash: string;
  outline: OutlineEntry[];
}

/** Units with content, in the shape the app's content helpers already use. */
export interface CourseContent {
  slug: string;
  contentHash: string;
  chapters: Chapter[];
}

export interface UnitNotes {
  number: number;
  markdown: string;
}

// ---- learning API ----

export interface ReviewRequest {
  id: string;
  itemKey: string;
  source: ReviewSource;
  sessionId: string | null;
  rating: Rating;
  correct: boolean;
  answer: string;
  hinted?: boolean;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

/** The server's review (before/after are full cards) and the card it scheduled. */
export interface ReviewResult {
  review: ReviewRecord & { before: Card; after: Card };
  card: Card;
}

export type Previews = Record<Rating, Card>;

export interface ImportResult {
  progress: ProgressData;
  skipped: number;
}

/** Only the fields sent change. First touch starts the exercise; "skipped" also suspends its card. */
export type ExercisePatch = Partial<Pick<ExerciseState, "status" | "notes" | "testsPassed" | "hintsRevealed">>;

export type { TodayQueue };

/** The course home: the question queue (no learn-ahead), exercises due for a redo, the next question due. */
export interface TodayInfo extends TodayQueue {
  redo: string[];
  nextDue: number | null;
}

/** Per kind: engine + course defaults, the learner's overrides, and the options the engine uses. */
export interface SchedulingInfo {
  defaults: Record<CardKind, Preset>;
  overrides: PresetOverrides;
  effective: Record<CardKind, Preset>;
}

/** Learner-wide settings (every course). */
export interface LearnerSettings {
  theme: Theme;
  showKeyHints: boolean;
  timeZone: string;
  prefs: SessionPrefs;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
