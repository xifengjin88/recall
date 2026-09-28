// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
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
