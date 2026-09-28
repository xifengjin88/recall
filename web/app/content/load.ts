// Loads a course from the API into ~/content and opens its progress store.
//
// React Router runs parent and child clientLoaders in parallel, so every loader under
// /c/:course awaits ensureCourse(); the promise is cached per slug, so it fetches once.

import { data } from "react-router";
import { api, ApiError } from "~/api/client";
import { loadCourseProgress } from "~/state/progress-store";
import { setCourse } from ".";

let loading: { slug: string; promise: Promise<void> } | null = null;

export function ensureCourse(slug: string): Promise<void> {
  if (loading?.slug === slug) return loading.promise;
  const promise = load(slug);
  loading = { slug, promise };
  // A failed load (e.g. server down) shouldn't stick: the next navigation retries.
  promise.catch(() => {
    if (loading?.promise === promise) loading = null;
  });
  return promise;
}

async function load(slug: string): Promise<void> {
  try {
    const [outline, content] = await Promise.all([api.course(slug), api.content(slug)]);
    const withNotes = outline.outline.filter((u) => u.hasNotes);
    const notes = await Promise.all(withNotes.map((u) => api.notes(slug, u.number)));
    setCourse(outline, content, new Map(notes.map((n) => [n.number, n.markdown])));
    await loadCourseProgress(slug);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) throw data("Course not found", { status: 404 });
    throw err;
  }
}
