// Response shapes of the Flask API (server/src/recall_api). Hand-written; kept honest by
// contract.ts, which type-checks real responses saved by server/tests/api/test_samples.py.

import type { Card, Rating } from "~/lib/engine";
import type { ProgressData, ReviewRecord, ReviewSource } from "~/lib/progress";
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

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
