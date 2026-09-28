import { dayStartMs, studyDay } from "./dates";
import { isDue, makeRng, type Card, type CardKind, type Preset } from "./engine";
import type { ReviewRecord, SessionLength, SessionMode, SessionOrder, SessionPrefs } from "./progress";
import { QUESTION_TYPES, type LoadedChapter, type Question, type QuestionType } from "./types";

export { makeRng };

/**
 * today    = Anki's study queue: learning cards, due reviews, then new cards, within the daily limits
 * due      = learning + due reviews only
 * mistakes = cards whose last answer was Again
 */
export type Scope = "today" | "chapter" | "sections" | "all" | "due" | "mistakes" | "ids";

export const SCOPE_LABELS: Record<Exclude<Scope, "ids">, string> = {
  today: "Today's queue",
  chapter: "This chapter",
  sections: "Selected sections",
  all: "All chapters",
  due: "Due only",
  mistakes: "Mistakes only",
};

/** Everything needed to rebuild a session. Round-trips through URL search params. */
export interface SessionSpec extends SessionPrefs {
  mode: Exclude<SessionMode, "exercise">;
  scope: Scope;
  /** Limits every scope except ids to one chapter. */
  chapter: number | null;
  sections: string[];
  /** Exact question ids (retry missed). Filters and length don't apply. */
  ids: string[];
  seed: number;
}

// ---- seeded shuffling -------------------------------------------------------

export function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const newSeed = () => Math.floor(Math.random() * 2 ** 31);

// ---- daily limits -----------------------------------------------------------

export interface DoneToday {
  newDone: number;
  reviewsDone: number;
}

/** New cards introduced and reviews done so far this study day, per card kind. */
export function doneToday(reviews: ReviewRecord[], now: number): Record<CardKind, DoneToday> {
  const out: Record<CardKind, DoneToday> = { question: { newDone: 0, reviewsDone: 0 }, exercise: { newDone: 0, reviewsDone: 0 } };
  const start = dayStartMs(studyDay(now));
  for (const r of reviews) {
    if (r.at < start) continue;
    if (r.before.phase === "new") out[r.kind].newDone++;
    else if (r.before.phase === "review") out[r.kind].reviewsDone++;
  }
  return out;
}

export interface TodayQueue {
  /** Learning / relearning cards due now (or within the learn-ahead window). */
  learning: string[];
  /** Review cards due, oldest first, capped by reviews/day. */
  review: string[];
  /** Unseen cards in the given order, capped by new/day. */
  fresh: string[];
}

/** Anki's queue for one card kind. `candidates` are the active item ids in study order. */
export function todayQueue(
  candidates: string[],
  cards: Record<string, Card>,
  now: number,
  preset: Preset,
  done: DoneToday,
  learnAhead = true,
): TodayQueue {
  const horizon = now + (learnAhead ? preset.learnAheadMinutes * 60_000 : 0);
  const learning: Card[] = [];
  const review: Card[] = [];
  const fresh: string[] = [];
  for (const id of candidates) {
    const c = cards[id];
    if (!c || c.phase === "new") {
      if (!c?.suspended) fresh.push(id);
    } else if (c.suspended) {
      continue;
    } else if (c.phase === "review") {
      if (isDue(c, now)) review.push(c);
    } else if (c.due <= horizon) {
      learning.push(c);
    }
  }
  const byDue = (a: Card, b: Card) => a.due - b.due;
  return {
    learning: learning.sort(byDue).map((c) => c.id),
    review: review.sort(byDue).slice(0, Math.max(0, preset.reviewsPerDay - done.reviewsDone)).map((c) => c.id),
    fresh: fresh.slice(0, Math.max(0, preset.newPerDay - done.newDone)),
  };
}

// ---- picking questions ------------------------------------------------------

/** Book order: chapter, then section position, then authored order within a section. */
export function bookOrder(chapters: LoadedChapter[]): Question[] {
  return chapters
    .flatMap((c) => {
      const pos = new Map(c.sections.map((s, i) => [s.id, i]));
      return c.questions.map((q, i) => ({ q, key: [c.number, pos.get(q.section) ?? 0, i] }));
    })
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
    .map((x) => x.q)
    .filter((q) => !q.retired);
}

export interface PickContext {
  cards: Record<string, Card>;
  reviews: ReviewRecord[];
  now: number;
  preset: Preset;
}

export function pickQuestions(chapters: LoadedChapter[], spec: SessionSpec, ctx: PickContext): Question[] {
  const all = bookOrder(chapters);
  const rng = makeRng(spec.seed);

  if (spec.scope === "ids") {
    const byId = new Map(all.map((q) => [q.id, q]));
    const picked = spec.ids.map((id) => byId.get(id)).filter((q): q is Question => !!q);
    return spec.order === "shuffled" ? shuffle(picked, rng) : picked;
  }

  const chapterIds =
    spec.chapter === null ? null : new Set(chapters.find((c) => c.number === spec.chapter)?.questions.map((q) => q.id));
  let pool = all.filter((q) => chapterIds === null || chapterIds.has(q.id));
  if (spec.types.length) pool = pool.filter((q) => spec.types.includes(q.type));
  if (spec.difficulty) pool = pool.filter((q) => q.difficulty === spec.difficulty);
  const cap = (qs: Question[]) => (spec.length === "all" ? qs : qs.slice(0, spec.length));

  if (spec.scope === "today" || spec.scope === "due") {
    const byId = new Map(pool.map((q) => [q.id, q]));
    const done = doneToday(ctx.reviews, ctx.now).question;
    const ordered = spec.order === "shuffled" ? shuffle(pool, rng) : pool;
    const queue = todayQueue(ordered.map((q) => q.id), ctx.cards, ctx.now, ctx.preset, done);
    const ids = [...queue.learning, ...queue.review, ...(spec.scope === "today" ? queue.fresh : [])];
    return cap(ids.map((id) => byId.get(id)!));
  }

  switch (spec.scope) {
    case "sections":
      pool = pool.filter((q) => spec.sections.includes(q.section));
      break;
    case "mistakes":
      pool = pool.filter((q) => ctx.cards[q.id]?.lastRating === "again");
      break;
  }
  return cap(spec.order === "shuffled" ? shuffle(pool, rng) : pool);
}

// ---- in-session order -------------------------------------------------------

/**
 * Which card to show next. Cards that went back into (re)learning during the session
 * return once due; if nothing else is left they're shown early, within the learn-ahead
 * window, like Anki. Null = the session is over.
 */
export function nextInSession(
  pending: string[],
  relearn: { id: string; due: number }[],
  now: number,
  learnAheadMs: number,
): { id: string; from: "pending" | "relearn" } | null {
  const ready = relearn.filter((r) => r.due <= now).sort((a, b) => a.due - b.due)[0];
  if (ready) return { id: ready.id, from: "relearn" };
  if (pending.length) return { id: pending[0], from: "pending" };
  const soon = relearn.filter((r) => r.due <= now + learnAheadMs).sort((a, b) => a.due - b.due)[0];
  return soon ? { id: soon.id, from: "relearn" } : null;
}

// ---- presentation -----------------------------------------------------------

/** The shuffled view of one question: option / item / definition display order. */
export interface Presentation {
  options?: string[];
  items?: string[];
  definitions?: string[];
}

export function present(q: Question, rng: () => number): Presentation {
  switch (q.type) {
    case "single":
    case "multi":
      return { options: q.keepOrder ? q.options : shuffle(q.options, rng) };
    case "output":
      return q.options ? { options: q.keepOrder ? q.options : shuffle(q.options, rng) } : {};
    case "truefalse":
      return { options: ["True", "False"] };
    case "order": {
      // Never start already solved.
      let items = shuffle(q.items, rng);
      for (let i = 0; i < 5 && items.every((it, j) => it === q.items[j]); i++) items = shuffle(q.items, rng);
      if (items.every((it, j) => it === q.items[j])) items = [...q.items].reverse();
      return { items };
    }
    case "match":
      return { definitions: shuffle(q.pairs.map((p) => p.definition), rng) };
    case "typed":
      return {};
  }
}

// ---- URL round-trip ---------------------------------------------------------

const LENGTHS: SessionLength[] = [10, 20, "all"];
const ORDERS: SessionOrder[] = ["shuffled", "book"];
const SCOPES: Scope[] = ["today", "chapter", "sections", "all", "due", "mistakes", "ids"];
const TYPES = QUESTION_TYPES.map((t) => t.type);

export function specToSearch(s: SessionSpec): string {
  const p = new URLSearchParams();
  p.set("mode", s.mode);
  p.set("scope", s.scope);
  if (s.chapter !== null) p.set("chapter", String(s.chapter));
  if (s.sections.length) p.set("sections", s.sections.join(","));
  if (s.ids.length) p.set("ids", s.ids.join(","));
  p.set("length", String(s.length));
  p.set("order", s.order);
  if (s.types.length) p.set("types", s.types.join(","));
  if (s.difficulty) p.set("difficulty", String(s.difficulty));
  p.set("seed", String(s.seed));
  return `?${p.toString()}`;
}

export function specFromSearch(p: URLSearchParams): SessionSpec {
  const list = (k: string) => (p.get(k) ?? "").split(",").filter(Boolean);
  const lengthRaw = p.get("length");
  const length = LENGTHS.find((l) => String(l) === lengthRaw) ?? 10;
  const chapter = Number(p.get("chapter"));
  const difficulty = Number(p.get("difficulty"));
  const seed = Number(p.get("seed"));
  return {
    mode: p.get("mode") === "flashcards" ? "flashcards" : "quiz",
    scope: SCOPES.find((s) => s === p.get("scope")) ?? "all",
    chapter: Number.isInteger(chapter) && chapter > 0 ? chapter : null,
    sections: list("sections"),
    ids: list("ids"),
    length,
    order: ORDERS.find((o) => o === p.get("order")) ?? "shuffled",
    types: list("types").filter((t): t is QuestionType => (TYPES as string[]).includes(t)),
    difficulty: ([1, 2, 3].includes(difficulty) ? difficulty : 0) as SessionSpec["difficulty"],
    seed: Number.isFinite(seed) && seed > 0 ? seed : newSeed(),
  };
}
