// Typed access to the Flask API. In development Vite proxies /api to the server on :5001.

import type { Card } from "~/lib/engine";
import type { AttemptMode, ExerciseState, ProgressData, SessionMode, SessionRecord } from "~/lib/progress";
import type {
  ApiErrorBody,
  CourseContent,
  CourseOutline,
  CoursesResponse,
  ExercisePatch,
  ImportResult,
  Previews,
  ReviewRequest,
  ReviewResult,
  UnitNotes,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { Accept: "application/json", ...init.headers } });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach the Recall server. Is it running (make dev-server)?");
  }
  if (!res.ok) {
    let body: Partial<ApiErrorBody> = {};
    try {
      body = (await res.json()) as Partial<ApiErrorBody>;
    } catch {
      // not JSON: fall back to the status text
    }
    throw new ApiError(res.status, body.error?.code ?? "http_error", body.error?.message ?? res.statusText, body.error?.details);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  courses: () => request<CoursesResponse>("/courses"),
  course: (slug: string) => request<CourseOutline>(`/courses/${enc(slug)}`),
  // The browser's HTTP cache revalidates with the ETag, so repeat loads are cheap 304s.
  content: (slug: string) => request<CourseContent>(`/courses/${enc(slug)}/content`),
  notes: (slug: string, unit: number) => request<UnitNotes>(`/courses/${enc(slug)}/units/${unit}/notes`),

  // ---- progress (the server schedules; see SPEC-learning-api.md) ----
  progress: (slug: string) => request<ProgressData>(`/courses/${enc(slug)}/progress`),
  importProgress: (slug: string, mode: "replace" | "merge", file: unknown) =>
    request<ImportResult>(`/courses/${enc(slug)}/progress`, json("PUT", { mode, file })),
  exportProgress: (slug: string) => request<unknown>(`/courses/${enc(slug)}/progress/export`),
  resetProgress: (slug: string, unit?: number) =>
    request<ProgressData>(`/courses/${enc(slug)}/progress${unit === undefined ? "" : `?unit=${unit}`}`, json("DELETE")),
  review: (slug: string, body: ReviewRequest) => request<ReviewResult>(`/courses/${enc(slug)}/reviews`, json("POST", body)),
  overrideReview: (slug: string, id: string) =>
    request<ReviewResult>(`/courses/${enc(slug)}/reviews/${enc(id)}/override`, json("POST")),
  preview: (slug: string, key: string) => request<Previews>(`/courses/${enc(slug)}/cards/${enc(key)}/preview`),
  patchCard: (slug: string, key: string, patch: { suspended: boolean }) =>
    request<Card>(`/courses/${enc(slug)}/cards/${enc(key)}`, json("PATCH", patch)),
  startSession: (slug: string, id: string, mode: SessionMode) =>
    request<SessionRecord>(`/courses/${enc(slug)}/sessions`, json("POST", { id, mode })),
  completeSession: (slug: string, id: string) =>
    request<SessionRecord>(`/courses/${enc(slug)}/sessions/${enc(id)}/complete`, json("POST")),
  patchExercise: (slug: string, key: string, patch: ExercisePatch) =>
    request<ExerciseState>(`/courses/${enc(slug)}/exercises/${enc(key)}`, json("PATCH", patch)),
  startAttempt: (slug: string, key: string, mode: Exclude<AttemptMode, "first">) =>
    request<ExerciseState>(`/courses/${enc(slug)}/exercises/${enc(key)}/attempts`, json("POST", { mode })),
};
