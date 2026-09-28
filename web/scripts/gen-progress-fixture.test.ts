// Fixture for server/tests/api/test_progress_io.py: a v1 (Leitner box) progress file and what the
// web app's migrateV1 turns it into, so the server's port can be checked against it.
//   GEN_GOLDEN=1 npx vitest run scripts/gen-progress-fixture.test.ts   # (re)write
//   npm test                                                          # check it is current

process.env.TZ = "America/New_York";

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrateV1 } from "../app/lib/progress";

const OUT = fileURLToPath(new URL("../../server/tests/api/fixtures/v1-migration.json", import.meta.url));

const V1 = {
  version: 1,
  items: {
    "demo-q001": { box: 3, due: "2026-10-01", mistake: false, updatedAt: 1790000000000 },
    "demo-q002": { box: 1, due: "2026-09-29", mistake: true, updatedAt: 1790000100000 },
    "demo-q003": { box: 0, due: null, mistake: false, updatedAt: 0 },
    "demo-q007": { box: 5, due: "2026-11-02", mistake: false, updatedAt: 1790000200000 },
  },
  attempts: [
    { id: "x1", questionId: "demo-q002", sessionId: "s1", mode: "quiz", at: 1790000100000, correct: false, hinted: false, overridden: false, answer: "a", boxBefore: 0, boxAfter: 1 },
    { id: "x2", questionId: "demo-q001", sessionId: "s1", mode: "flashcards", at: 1790000000000, correct: true, hinted: false, overridden: false, answer: "easy", rating: "easy", boxBefore: 1, boxAfter: 3 },
    { id: "x3", questionId: "demo-q007", sessionId: "s2", mode: "quiz", at: 1790000200000, correct: true, hinted: true, overridden: false, answer: "one two three", boxBefore: 4, boxAfter: 5 },
  ],
  sessions: [
    { id: "s1", mode: "quiz", startedAt: 1789999000000, completedAt: 1790000150000, completedDay: "2026-09-21" },
    { id: "s2", mode: "quiz", startedAt: 1790000180000 },
  ],
  exercises: { "demo-ex01": { status: "in-progress", testsPassed: ["prints hello"], hintsRevealed: 1, notes: "use write(2)", updatedAt: 1790000300000 } },
  settings: { theme: "dark", showKeyHints: false, obsidianVault: "Vault" },
  prefs: { length: 20, order: "book", types: ["single"], difficulty: 2 },
  lastChapter: 1,
};

function render(): string {
  return JSON.stringify({ tz: process.env.TZ, input: V1, expected: migrateV1(V1) }, null, 1) + "\n";
}

describe("progress v1 migration fixture", () => {
  it(process.env.GEN_GOLDEN ? "writes server/tests/api/fixtures/v1-migration.json" : "is up to date with migrateV1", () => {
    const text = render();
    if (process.env.GEN_GOLDEN) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, text);
    }
    expect(readFileSync(OUT, "utf8")).toBe(text);
  });
});
