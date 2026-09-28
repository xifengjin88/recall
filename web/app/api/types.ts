// Response shapes of the Flask API (server/src/recall_api). Hand-written; kept honest by
// contract.ts, which type-checks real responses saved by server/tests/api/test_samples.py.

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

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
