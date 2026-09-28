// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { samples } from "~/api/contract";
import * as store from "./progress-store";

type Call = { method: string; path: string; body: unknown };

/** Answers each request from `routes` ("METHOD /path" → body, or a status code to fail with). */
function mockApi(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = url.replace(/^\/api/, "");
      calls.push({ method, path, body: init.body ? JSON.parse(init.body as string) : undefined });
      const hit = routes[`${method} ${path}`];
      if (hit === undefined || typeof hit === "number") {
        const status = typeof hit === "number" ? hit : 404;
        return new Response(JSON.stringify({ error: { code: "x", message: "failed" } }), { status });
      }
      return new Response(JSON.stringify(hit), { status: 200 });
    }),
  );
  return calls;
}

const base = "/courses/demo";
const emptyProgress = { ...samples.progress, cards: {}, reviews: [], sessions: [] };

beforeEach(() => {
  store.__resetStoreForTests();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("progress store (API-backed)", () => {
  it("loads a course's progress and mirrors the theme", async () => {
    mockApi({ [`GET ${base}/progress`]: { ...samples.progress, settings: { ...samples.progress.settings, theme: "dark" } } });
    expect(store.getProgress().cards).toEqual({});
    await store.loadCourseProgress("demo");
    expect(store.getProgress().cards["demo-q001"].phase).toBe("learning");
    expect(localStorage.getItem(store.THEME_KEY)).toBe("dark");
  });

  it("sends a rating and uses the card the server scheduled", async () => {
    const calls = mockApi({ [`GET ${base}/progress`]: emptyProgress, [`POST ${base}/reviews`]: samples.review });
    await store.loadCourseProgress("demo");
    const { before, after } = await store.recordReview({
      reviewId: "s1:0",
      cardId: "demo-q001",
      kind: "question",
      source: "quiz",
      sessionId: "s1",
      rating: "again",
      correct: false,
      answer: "a",
      durationMs: 3000,
    });
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: `${base}/reviews`,
      body: { id: "s1:0", itemKey: "demo-q001", source: "quiz", sessionId: "s1", rating: "again", correct: false, answer: "a", durationMs: 3000 },
    });
    expect(before.phase).toBe("new");
    expect(after).toEqual(samples.review.card);
    expect(store.getProgress().cards["demo-q001"]).toEqual(samples.review.card);
    expect(store.getProgress().reviews.map((r) => r.id)).toEqual(["s1:0"]);
  });

  it("replaces a review in memory when the server returns it again (retry or override)", async () => {
    mockApi({
      [`GET ${base}/progress`]: samples.progress,
      [`POST ${base}/reviews/s1%3A0/override`]: { ...samples.review, review: { ...samples.review.review, rating: "hard", overridden: true } },
    });
    await store.loadCourseProgress("demo");
    await store.overrideReview("s1:0");
    expect(store.getProgress().reviews).toHaveLength(1);
    expect(store.getProgress().reviews[0]).toMatchObject({ rating: "hard", overridden: true });
  });

  it("shows the save-failed notice and rejects when a rating can't be saved", async () => {
    mockApi({ [`GET ${base}/progress`]: emptyProgress, [`POST ${base}/reviews`]: 500 });
    await store.loadCourseProgress("demo");
    const input = { reviewId: "r", cardId: "demo-q001", kind: "question", source: "quiz", sessionId: null, rating: "good", correct: true, answer: "" } as const;
    await expect(store.recordReview(input)).rejects.toMatchObject({ status: 500 });
    expect(store.getProgress().cards).toEqual({});
    expect(store.getStatus().notice).toBe("save-failed");
  });

  it("sends background changes in order and flags a failure", async () => {
    const calls = mockApi({
      [`GET ${base}/progress`]: emptyProgress,
      [`POST ${base}/sessions`]: samples.session,
      [`POST ${base}/sessions/s1/complete`]: { ...samples.session, completedAt: 5, completedDay: "2026-09-28" },
      [`PATCH ${base}/cards/demo-q001`]: 500,
    });
    await store.loadCourseProgress("demo");
    store.startSession("s1", "quiz");
    expect(store.getProgress().sessions).toHaveLength(1); // memory updates at once
    store.completeSession("s1");
    store.setSuspended("demo-q001", "question", true);
    await store.flushWrites();
    expect(calls.slice(1).map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${base}/sessions`,
      `POST ${base}/sessions/s1/complete`,
      `PATCH ${base}/cards/demo-q001`,
    ]);
    expect(store.getProgress().sessions[0].completedDay).toBe("2026-09-28");
    expect(store.getStatus().notice).toBe("save-failed");
  });

  it("debounces exercise notes and keeps them ahead of a later status change", async () => {
    vi.useFakeTimers();
    try {
      const ex = `${base}/exercises/demo-ex01`;
      const calls = mockApi({ [`GET ${base}/progress`]: emptyProgress, [`PATCH ${ex}`]: {} });
      await store.loadCourseProgress("demo");
      store.updateExercise("demo-ex01", { notes: "w" });
      store.updateExercise("demo-ex01", { notes: "write(2)" });
      expect(store.getProgress().exercises["demo-ex01"]).toMatchObject({ status: "in-progress", notes: "write(2)" });
      await vi.advanceTimersByTimeAsync(600);
      store.updateExercise("demo-ex01", { notes: "write(2) then exit" });
      store.updateExercise("demo-ex01", { status: "skipped" }); // sends the pending notes first
      await store.flushWrites();
      expect(calls.slice(1).map((c) => c.body)).toEqual([{ notes: "write(2)" }, { notes: "write(2) then exit" }, { status: "skipped" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks an exercise done in memory when its rating is saved", async () => {
    const exerciseReview = {
      review: { ...samples.review.review, id: "e1", cardId: "demo-ex01", kind: "exercise", source: "exercise" },
      card: { ...samples.review.card, id: "demo-ex01", kind: "exercise" },
    };
    mockApi({ [`GET ${base}/progress`]: emptyProgress, [`POST ${base}/reviews`]: exerciseReview });
    await store.loadCourseProgress("demo");
    await store.recordReview({ reviewId: "e1", cardId: "demo-ex01", kind: "exercise", source: "exercise", sessionId: null, rating: "good", correct: true, answer: "" });
    expect(store.getProgress().exercises["demo-ex01"].status).toBe("done");
  });

  it("imports the raw file and resets one unit through the API", async () => {
    const calls = mockApi({
      [`GET ${base}/progress`]: emptyProgress,
      [`PUT ${base}/progress`]: { progress: samples.progress, skipped: 2 },
      [`DELETE ${base}/progress?unit=1`]: emptyProgress,
    });
    await store.loadCourseProgress("demo");
    const file = { app: "recall", data: { version: 1, items: {} } };
    await expect(store.importProgress(file, "merge")).resolves.toBe(2);
    expect(calls.at(-1)?.body).toEqual({ mode: "merge", file });
    expect(Object.keys(store.getProgress().cards)).toEqual(["demo-q001"]);
    await store.resetProgress(1);
    expect(store.getProgress().cards).toEqual({});
  });
});

