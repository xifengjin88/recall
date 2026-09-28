// Typed access to the Flask API. In development Vite proxies /api to the server on :5001.

import type { ApiErrorBody, CourseContent, CourseOutline, CoursesResponse, UnitNotes } from "./types";

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

export const api = {
  courses: () => request<CoursesResponse>("/courses"),
  course: (slug: string) => request<CourseOutline>(`/courses/${enc(slug)}`),
  // The browser's HTTP cache revalidates with the ETag, so repeat loads are cheap 304s.
  content: (slug: string) => request<CourseContent>(`/courses/${enc(slug)}/content`),
  notes: (slug: string, unit: number) => request<UnitNotes>(`/courses/${enc(slug)}/units/${unit}/notes`),
};
