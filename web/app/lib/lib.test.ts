import { describe, expect, it } from "vitest";
import { addDays, dayStartMs, studyDay } from "./dates";
import { newCard, QUESTION_PRESET, type Card } from "./engine";
import { grade, normalizeText } from "./grade";
import { mastery, sectionMastery } from "./mastery";
import {
  emptyProgress,
  exportProgress,
  mergeProgress,
  migrateV1,
  parseProgress,
  resetAll,
  type ReviewRecord,
} from "./progress";
import { doneToday, makeRng, nextInSession, pickQuestions, present, specFromSearch, specToSearch, todayQueue, type SessionSpec } from "./session";
import { forecast, streak, weakest } from "./stats";
import type { Chapter, LoadedChapter, Question } from "./types";
import { validateBook } from "./validate";


const NOW = new Date(2026, 8, 27, 12).getTime();
const DAY = studyDay(NOW);

const base = { section: "1.1", explanation: "x", difficulty: 1 as const };
const single: Question = { ...base, id: "s", type: "single", prompt: "p", options: ["a", "b", "c"], answer: "b" };
const multi: Question = { ...base, id: "m", type: "multi", prompt: "p", options: ["a", "b", "c"], answers: ["a", "c"] };
const tf: Question = { ...base, id: "t", type: "truefalse", prompt: "p", answer: false };
const typed: Question = { ...base, id: "y", type: "typed", prompt: "p", accept: ["System Call"] };
const outText: Question = { ...base, id: "o1", type: "output", prompt: "p", code: { lang: "bash", source: "x" }, accept: ["/usr/lib"] };
const outChoice: Question = {
  ...base,
  id: "o2",
  type: "output",
  prompt: "p",
  code: { lang: "c", source: "x" },
  options: ["1", "2"],
  answer: "2",
};
const order: Question = { ...base, id: "r", type: "order", prompt: "p", items: ["one", "two", "three"] };
const match: Question = {
  ...base,
  id: "h",
  type: "match",
  prompt: "p",
  pairs: [
    { term: "A", definition: "a" },
    { term: "B", definition: "b" },
    { term: "C", definition: "c" },
  ],
};

describe("grade (spec §5.3, acceptance 3)", () => {
  it("single / truefalse / output-choice", () => {
    expect(grade(single, { kind: "choice", value: "b" })).toBe(true);
    expect(grade(single, { kind: "choice", value: "a" })).toBe(false);
    expect(grade(tf, { kind: "bool", value: false })).toBe(true);
    expect(grade(tf, { kind: "bool", value: true })).toBe(false);
    expect(grade(outChoice, { kind: "choice", value: "2" })).toBe(true);
  });

  it("multi requires the exact set, with no partial credit", () => {
    expect(grade(multi, { kind: "multi", values: ["c", "a"] })).toBe(true);
    expect(grade(multi, { kind: "multi", values: ["a"] })).toBe(false);
    expect(grade(multi, { kind: "multi", values: ["a", "b", "c"] })).toBe(false);
    expect(grade(multi, { kind: "multi", values: [] })).toBe(false);
  });

  it("typed ignores case and extra whitespace", () => {
    expect(grade(typed, { kind: "text", value: "  system    CALL " })).toBe(true);
    expect(grade(typed, { kind: "text", value: "systemcall" })).toBe(false);
    expect(grade(typed, { kind: "text", value: "   " })).toBe(false);
    expect(grade({ ...typed, caseSensitive: true } as Question, { kind: "text", value: "system call" })).toBe(false);
    expect(grade(outText, { kind: "text", value: "/usr/lib" })).toBe(true);
    expect(normalizeText("  A\t b  ")).toBe("a b");
  });

  it("order and match need everything right", () => {
    expect(grade(order, { kind: "order", items: ["one", "two", "three"] })).toBe(true);
    expect(grade(order, { kind: "order", items: ["two", "one", "three"] })).toBe(false);
    expect(grade(match, { kind: "match", pairs: { A: "a", B: "b", C: "c" } })).toBe(true);
    expect(grade(match, { kind: "match", pairs: { A: "a", B: "c", C: "b" } })).toBe(false);
  });
});


const chapter = (over: Partial<Chapter> = {}): Chapter => ({
  number: 1,
  title: "T",
  note: "N",
  sections: [
    { id: "1.1", title: "A" },
    { id: "1.2", title: "B" },
  ],
  questions: [single, multi, { ...tf, section: "1.2" }, { ...typed, retired: true }],
  ...over,
});


const review = (id: string, interval: number, over: Partial<Card> = {}): Card => ({
  ...newCard(id, "question", QUESTION_PRESET),
  phase: "review",
  interval,
  due: dayStartMs(DAY),
  lastReview: NOW - interval * 86_400_000,
  updatedAt: 1,
  ...over,
});

describe("content validation (spec §5.5, acceptance 12)", () => {
  it("reports and skips a question whose answer is not among its options", () => {
    const broken = { ...single, id: "bad", answer: "zzz" };
    const { chapters, errors } = validateBook([chapter({ questions: [single, broken] })]);
    expect(chapters[0].questions.map((q) => q.id)).toEqual(["s"]);
    expect(errors).toEqual([{ where: "Chapter 1 › bad", message: 'answer "zzz" is not among the options' }]);
  });

  it("catches duplicate ids, unknown sections, empty accept, short match, missing fields", () => {
    const { chapters, errors } = validateBook([
      chapter({
        questions: [
          single,
          { ...multi, id: "s" },
          { ...tf, id: "t2", section: "9.9" },
          { ...typed, accept: [] },
          { ...match, pairs: match.pairs.slice(0, 2) },
          { ...multi, id: "m2", answers: [] },
          { id: "x", type: "single" } as unknown as Question,
        ],
      }),
    ]);
    expect(chapters[0].questions.map((q) => q.id)).toEqual(["s"]);
    const msgs = errors.map((e) => e.message).join("\n");
    expect(msgs).toContain("duplicate id");
    expect(msgs).toContain('section "9.9" is not in the chapter');
    expect(msgs).toContain('"accept" list is empty');
    expect(msgs).toContain("match needs 3–6 pairs");
    expect(msgs).toContain("multi question has no answers");
    expect(msgs).toContain('missing required field "prompt"');
  });

  it("drops a chapter without sections but keeps the rest", () => {
    const { chapters, errors } = validateBook([chapter(), chapter({ number: 3, sections: [] })]);
    expect(chapters.map((c) => c.number)).toEqual([1]);
    expect(errors[0].where).toBe("Chapter 3");
  });

  it("a course loaded from the API populates the content helpers", async () => {
    const content = await import("~/content");
    const { samples } = await import("~/api/contract");
    const notes = new Map([[1, samples.notes.markdown]]);
    content.setCourse(samples.course, samples.content, notes);
    expect(content.CONTENT_ERRORS).toEqual([]);
    expect(content.SUBJECT).toMatchObject({ id: "demo", short: "DEMO" });
    expect(content.TOC.map((t) => t.number)).toEqual([1, 2]);
    expect(content.getChapter(1)?.questions).toHaveLength(8);
    expect(content.QUESTIONS_BY_ID.get("demo-q004")?.type).toBe("typed");
    expect(content.chapterOf("demo-ex01")).toBe(1);
    expect(content.hasNotes(1) && !content.hasNotes(2)).toBe(true);
  });
});


describe("mastery (spec §6.3: mature at 21 days)", () => {
  it("counts review cards with interval >= 21 over active questions only", () => {
    const [ch] = validateBook([chapter()]).chapters;
    const cards: Record<string, Card> = {
      s: review("s", 21),
      m: review("m", 20),
      t: review("t", 40),
      y: review("y", 99), // retired: ignored
    };
    expect(mastery(ch.questions, cards)).toEqual({ mastered: 2, total: 3, percent: 66 });
    expect(sectionMastery(ch, "1.1", cards)).toEqual({ mastered: 1, total: 2, percent: 50 });
    expect(sectionMastery(ch, "1.2", cards)).toEqual({ mastered: 1, total: 1, percent: 100 });
  });
});

const rev = (id: string, cardId: string, correct: boolean, over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id,
  cardId,
  kind: "question",
  source: "quiz",
  sessionId: "x",
  at: NOW,
  rating: correct ? "good" : "again",
  correct,
  answer: "",
  hinted: false,
  overridden: false,
  before: { phase: "new", interval: 0, ease: 2.5, due: 0 },
  after: { phase: "learning", interval: 0, ease: 2.5, due: NOW },
  ...over,
});

describe("sessions", () => {
  const [ch] = validateBook([chapter({ questions: [single, multi, { ...tf, section: "1.2" }, typed, order] })])
    .chapters as LoadedChapter[];
  const spec = (over: Partial<SessionSpec>): SessionSpec => ({
    mode: "quiz",
    scope: "chapter",
    chapter: 1,
    sections: [],
    ids: [],
    length: 10,
    order: "book",
    types: [],
    difficulty: 0,
    seed: 42,
    ...over,
  });
  const ctx = (cards: Record<string, Card> = {}, reviews: ReviewRecord[] = []) => ({ cards, reviews, now: NOW, preset: QUESTION_PRESET });
  const ids = (s: SessionSpec, c = ctx()) => pickQuestions([ch], s, c).map((q) => q.id);

  it("scopes, filters and limits", () => {
    // book order: by section (t is in 1.2), then authored order
    expect(ids(spec({}))).toEqual(["s", "m", "y", "r", "t"]);
    expect(ids(spec({ scope: "sections", sections: ["1.2"] }))).toEqual(["t"]);
    expect(ids(spec({ types: ["typed", "order"] }))).toEqual(["y", "r"]);
    expect(ids(spec({ length: 10, order: "shuffled" })).sort()).toEqual(["m", "r", "s", "t", "y"]);
    const cards = { m: review("m", 3, { lastRating: "again" }), s: review("s", 5, { due: dayStartMs(addDays(DAY, 2)) }) };
    expect(ids(spec({ scope: "due" }), ctx(cards))).toEqual(["m"]);
    expect(ids(spec({ scope: "mistakes" }), ctx(cards))).toEqual(["m"]);
  });

  it("today's queue: learning, then due reviews, then new cards, within daily limits", () => {
    const cards = {
      r: review("r", 3),
      t: { ...review("t", 0), phase: "learning" as const, due: NOW - 1 },
      s: review("s", 5, { due: dayStartMs(addDays(DAY, 3)) }),
    };
    expect(ids(spec({ scope: "today" }), ctx(cards))).toEqual(["t", "r", "m", "y"]);
    const q = todayQueue(["s", "m", "t", "y", "r"], cards, NOW, { ...QUESTION_PRESET, newPerDay: 3 }, { newDone: 2, reviewsDone: 0 });
    expect(q.fresh).toEqual(["m"]);
    const done = doneToday([rev("a", "x", true), rev("b", "y", true, { before: { phase: "review", interval: 3, ease: 2.5, due: 0 } })], NOW);
    expect(done.question).toEqual({ newDone: 1, reviewsDone: 1 });
    expect(todayQueue(["r"], cards, NOW, { ...QUESTION_PRESET, reviewsPerDay: 1 }, done.question).review).toEqual([]);
  });

  it("brings relearning cards back when due, or early when nothing else is left", () => {
    const relearn = [{ id: "a", due: NOW + 60_000 }];
    expect(nextInSession(["b"], relearn, NOW, 20 * 60_000)).toEqual({ id: "b", from: "pending" });
    expect(nextInSession(["b"], relearn, NOW + 60_000, 20 * 60_000)).toEqual({ id: "a", from: "relearn" });
    expect(nextInSession([], relearn, NOW, 20 * 60_000)).toEqual({ id: "a", from: "relearn" });
    expect(nextInSession([], [{ id: "a", due: NOW + 30 * 60_000 }], NOW, 20 * 60_000)).toBeNull();
  });

  it("retry uses exactly the given ids (acceptance 6)", () => {
    const got = pickQuestions([ch], spec({ scope: "ids", ids: ["r", "s"], length: 10, types: ["multi"] }), ctx());
    expect(got.map((q) => q.id).sort()).toEqual(["r", "s"]);
  });

  it("round-trips through the URL", () => {
    const s = spec({ scope: "sections", sections: ["1.1", "1.2"], types: ["multi"], difficulty: 2, length: "all" });
    expect(specFromSearch(new URLSearchParams(specToSearch(s)))).toEqual(s);
  });

  it("presents order questions unsolved and keeps keepOrder options", () => {
    for (let seed = 1; seed < 50; seed++) {
      expect(present(order, makeRng(seed)).items).not.toEqual(["one", "two", "three"]);
    }
    const kept = { ...single, keepOrder: true } as Question;
    expect(present(kept, makeRng(1)).options).toEqual(["a", "b", "c"]);
  });
});

describe("progress data (spec §7)", () => {
  it("export → reset everything → import (replace) restores identical progress (acceptance 11)", () => {
    const p = emptyProgress();
    p.cards.s = review("s", 7);
    p.reviews.push(rev("a1", "s", true));
    p.exercises.e = {
      status: "done",
      notes: "hi",
      attempt: "first",
      attemptStartedAt: 1,
      testsPassed: ["t1"],
      hintsRevealed: 1,
      updatedAt: 5,
    };
    p.settings.theme = "dark";
    p.settings.scheduling = { question: { newPerDay: 5 } };
    const file = exportProgress(p, "tlpi");
    expect(resetAll(p).cards).toEqual({});
    expect(parseProgress(JSON.parse(file))).toEqual(p);
  });

  it("merge keeps the most recent record per item and unions history", () => {
    const a = emptyProgress();
    const b = emptyProgress();
    a.cards.s = review("s", 1, { updatedAt: 10 });
    b.cards.s = review("s", 16, { updatedAt: 20 });
    a.cards.m = review("m", 3, { updatedAt: 30 });
    b.cards.m = review("m", 35, { updatedAt: 1 });
    a.reviews = [rev("a1", "s", false, { at: 1 })];
    b.reviews = [rev("a1", "s", false, { at: 1 }), rev("a2", "s", true, { at: 2 })];
    const m = mergeProgress(a, b);
    expect(m.cards.s.interval).toBe(16);
    expect(m.cards.m.interval).toBe(3);
    expect(m.reviews.map((x) => x.id)).toEqual(["a1", "a2"]);
  });

  it("migrates v1 (Leitner boxes) progress and exports", () => {
    const v1 = {
      version: 1,
      items: {
        q1: { box: 3, due: "2026-10-01", mistake: false, updatedAt: 5 },
        q2: { box: 1, due: "2026-09-28", mistake: true, updatedAt: 6 },
        q3: { box: 0, due: null, mistake: false, updatedAt: 0 },
      },
      attempts: [
        { id: "x1", questionId: "q2", sessionId: "s", mode: "quiz", at: 6, correct: false, hinted: false, overridden: false, answer: "True", boxBefore: 0, boxAfter: 1 },
        { id: "x2", questionId: "q1", sessionId: "s", mode: "flashcards", at: 7, correct: true, hinted: false, overridden: false, answer: "easy", rating: "easy", boxBefore: 1, boxAfter: 3 },
      ],
      sessions: [{ id: "s", mode: "quiz", startedAt: 1, completedAt: 9, completedDay: "2026-09-27" }],
      exercises: { e1: { status: "in-progress", testsPassed: ["a"], hintsRevealed: 2, notes: "n", updatedAt: 3 } },
      settings: { theme: "dark", showKeyHints: false, obsidianVault: "Vault" },
      prefs: { length: 20, order: "book", types: [], difficulty: 0 },
      lastChapter: 2,
    };
    const p = migrateV1(v1);
    expect(p.cards.q1).toMatchObject({ phase: "review", interval: 7, ease: 2.5, due: dayStartMs("2026-10-01"), lastRating: "good" });
    expect(p.cards.q2).toMatchObject({ interval: 1, lastRating: "again", reps: 1 });
    expect(p.cards.q3).toBeUndefined();
    expect(p.reviews.map((r) => [r.cardId, r.rating, r.source])).toEqual([
      ["q2", "again", "quiz"],
      ["q1", "easy", "flashcard"],
    ]);
    expect(p.exercises.e1).toMatchObject({ status: "in-progress", testsPassed: ["a"], hintsRevealed: 2, notes: "n", attempt: "first" });
    expect(p.settings).toEqual({ theme: "dark", showKeyHints: false, scheduling: {} });
    expect(p.prefs.length).toBe(20);
    // old export files are accepted too
    expect(parseProgress({ app: "tlpi-drill", data: v1 })?.cards.q1.interval).toBe(7);
  });

  it("rejects unrecognisable data", () => {
    expect(parseProgress({ nope: true })).toBeNull();
    expect(parseProgress(null)).toBeNull();
  });
});

describe("stats", () => {
  const done = (day: string) => ({ id: day, mode: "quiz" as const, startedAt: 0, completedAt: 1, completedDay: day });
  it("streak counts consecutive completed days and survives until a day is missed", () => {
    expect(streak([done("2026-09-25"), done("2026-09-26"), done(DAY)], DAY)).toBe(3);
    expect(streak([done("2026-09-25"), done("2026-09-26")], DAY)).toBe(2);
    expect(streak([done("2026-09-24"), done("2026-09-25")], DAY)).toBe(0);
    expect(streak([{ ...done(DAY), completedDay: undefined }], DAY)).toBe(0);
  });

  it("weakest ranks by wrong count", () => {
    const w = weakest([rev("1", "a", false), rev("2", "b", false), rev("3", "b", false), rev("4", "c", true)]);
    expect(w.map((x) => x.cardId)).toEqual(["b", "a"]);
  });

  it("forecast buckets due reviews by day, overdue into today", () => {
    const f = forecast([review("a", 1, { due: dayStartMs(addDays(DAY, -3)) }), review("b", 2, { due: dayStartMs(addDays(DAY, 2)) })], DAY, 3);
    expect(f.map((x) => x.count)).toEqual([1, 0, 1]);
  });
});

describe("exercise rating suggestion", () => {
  it("parses estimates", async () => {
    const { parseEstimate } = await import("./exercise-rating");
    expect(parseEstimate("45 min")).toBe(45);
    expect(parseEstimate("1.5 hours")).toBe(90);
    expect(parseEstimate("soon")).toBeNull();
  });

  it("suggests Hard after hints or a long attempt, otherwise Good", async () => {
    const { suggestRating } = await import("./exercise-rating");
    expect(suggestRating({ hintsRevealed: 1, durationMs: 0, estimate: "45 min" }).rating).toBe("hard");
    expect(suggestRating({ hintsRevealed: 0, durationMs: 100 * 60_000, estimate: "45 min" }).rating).toBe("hard");
    expect(suggestRating({ hintsRevealed: 0, durationMs: 50 * 60_000, estimate: "45 min" }).rating).toBe("good");
    expect(suggestRating({ hintsRevealed: 0, durationMs: null }).rating).toBe("good");
  });
});
