// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { newCard, QUESTION_PRESET } from "~/lib/engine";
import { emptyProgress } from "~/lib/progress";
import { IdbRepo } from "./idb-repo";

let n = 0;
const freshDb = () => `test-${Date.now()}-${n++}`;

describe("IdbRepo", () => {
  it("is empty at first, then round-trips commits", async () => {
    const repo = new IdbRepo(freshDb());
    expect(await repo.load()).toBeNull();
    const card = { ...newCard("q1", "question", QUESTION_PRESET), phase: "review" as const, interval: 3, updatedAt: 1 };
    await repo.commit({
      cards: [card],
      sessions: [{ id: "s1", mode: "quiz", startedAt: 1 }],
      exercises: { e1: { ...emptyProgress().exercises.e1, status: "done", notes: "n", attempt: "first", attemptStartedAt: null, testsPassed: [], hintsRevealed: 0, updatedAt: 2 } },
      meta: { lastChapter: 2 },
    });
    const loaded = await repo.load();
    expect(loaded?.cards.q1.interval).toBe(3);
    expect(loaded?.sessions).toHaveLength(1);
    expect(loaded?.exercises.e1.notes).toBe("n");
    expect(loaded?.lastChapter).toBe(2);
    await repo.destroy();
  });

  it("deletes an item's card, exercise state and reviews together", async () => {
    const repo = new IdbRepo(freshDb());
    const snap = { phase: "new" as const, interval: 0, ease: 2.5, due: 0 };
    await repo.commit({
      cards: [newCard("a", "question", QUESTION_PRESET), newCard("b", "question", QUESTION_PRESET)],
      reviews: ["a", "a", "b"].map((cardId, i) => ({
        id: `r${i}`,
        cardId,
        kind: "question" as const,
        source: "quiz" as const,
        sessionId: null,
        at: i,
        rating: "good" as const,
        correct: true,
        answer: "",
        hinted: false,
        overridden: false,
        before: snap,
        after: snap,
      })),
    });
    await repo.commit({ deleteItems: ["a"] });
    const loaded = (await repo.load())!;
    expect(Object.keys(loaded.cards)).toEqual(["b"]);
    expect(loaded.reviews.map((r) => r.cardId)).toEqual(["b"]);
    await repo.destroy();
  });

  it("replaceAll swaps everything", async () => {
    const repo = new IdbRepo(freshDb());
    await repo.commit({ cards: [newCard("old", "question", QUESTION_PRESET)] });
    const next = emptyProgress();
    next.cards.new = newCard("new", "question", QUESTION_PRESET);
    next.settings.theme = "dark";
    await repo.replaceAll(next);
    const loaded = (await repo.load())!;
    expect(Object.keys(loaded.cards)).toEqual(["new"]);
    expect(loaded.settings.theme).toBe("dark");
    await repo.destroy();
  });
});

describe("progress store", () => {
  beforeEach(() => localStorage.clear());

  it("migrates v1 localStorage progress into IndexedDB once, keeping a backup", async () => {
    localStorage.setItem(
      "tlpi-drill:progress",
      JSON.stringify({ version: 1, items: { q1: { box: 2, due: "2026-10-01", mistake: false, updatedAt: 5 } }, attempts: [], settings: { theme: "dark" } }),
    );
    const store = await import("./progress-store");
    const db = store.courseDbName("tlpi"); // old localStorage progress belongs to TLPI
    await store.initProgress(db);
    expect(store.getProgress().cards.q1).toMatchObject({ phase: "review", interval: 3 });
    expect(localStorage.getItem("tlpi-drill:progress")).toBeNull();
    expect(localStorage.getItem("tlpi-drill:progress:migrated-to-indexeddb")).toContain('"box":2');
    expect(localStorage.getItem(store.THEME_KEY)).toBe("dark");
    expect((await new IdbRepo(db).load())?.cards.q1.interval).toBe(3);
  });

  it("persists a review so it survives a reload", async () => {
    const store = await import("./progress-store");
    const db = freshDb();
    const repo = new IdbRepo(db);
    store.__resetStoreForTests(repo);
    const { after } = store.recordReview({
      reviewId: "r1",
      cardId: "q9",
      kind: "question",
      source: "quiz",
      sessionId: null,
      rating: "again",
      correct: false,
      answer: "x",
    });
    expect(after.phase).toBe("learning");
    await store.flushWrites();
    const reloaded = (await new IdbRepo(db).load())!;
    expect(reloaded.cards.q9.phase).toBe("learning");
    expect(reloaded.reviews[0]).toMatchObject({ id: "r1", rating: "again", before: { phase: "new" } });
  });
});
