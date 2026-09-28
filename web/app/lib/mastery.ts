import { isMastered, MATURE_DAYS, type Card } from "./cards";
import type { ExerciseState } from "./progress";
import type { LoadedChapter, Question } from "./types";

export { MATURE_DAYS };

export interface Mastery {
  mastered: number;
  total: number;
  /** 0–100, rounded down. 0 when there's nothing to master. */
  percent: number;
}

export const activeQuestions = (qs: Question[]) => qs.filter((q) => !q.retired);

/** Mastered = the card's review interval has reached 21 days (Anki's "mature"). */
export function mastery(questions: Question[], cards: Record<string, Card>): Mastery {
  const active = activeQuestions(questions);
  const mastered = active.filter((q) => isMastered(cards[q.id])).length;
  return { mastered, total: active.length, percent: active.length ? Math.floor((mastered / active.length) * 100) : 0 };
}

export function sectionMastery(ch: LoadedChapter, sectionId: string, cards: Record<string, Card>): Mastery {
  return mastery(
    ch.questions.filter((q) => q.section === sectionId),
    cards,
  );
}

export type ChapterStatus = "not-started" | "in-progress" | "mastered";
export const MASTERED_PERCENT = 80;

export function chapterStatus(ch: LoadedChapter, cards: Record<string, Card>, exercises: Record<string, ExerciseState>): ChapterStatus {
  const m = mastery(ch.questions, cards);
  if (m.total > 0 && m.percent >= MASTERED_PERCENT) return "mastered";
  const touched =
    activeQuestions(ch.questions).some((q) => cards[q.id]) ||
    ch.exercises.some((e) => exercises[e.id] && exercises[e.id].status !== "not-started");
  return touched ? "in-progress" : "not-started";
}
