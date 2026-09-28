// The current course's content, loaded from the API by ensureCourse() (./load.ts).
//
// These are live bindings (`export let`), so screens keep importing CHAPTERS, getChapter,
// QUESTIONS_BY_ID … exactly as they did when content was bundled; setCourse() swaps them.

import type { CourseContent, CourseOutline } from "~/api/types";
import { extractNoteSection } from "~/lib/notes";
import type { Exercise, LoadedChapter, Question, TocEntry } from "~/lib/types";
import { validateBook, type ContentError } from "~/lib/validate";

export interface Subject {
  /** The course slug: names its progress database and its URLs. */
  id: string;
  title: string;
  short: string;
  author: string | null;
}

export let SUBJECT: Subject = { id: "", title: "", short: "", author: null };
export let TOC: TocEntry[] = [];
export let CHAPTERS: LoadedChapter[] = [];
export let CONTENT_ERRORS: ContentError[] = [];
export let ALL_QUESTIONS: Question[] = [];
export let QUESTIONS_BY_ID = new Map<string, Question>();
export let ALL_EXERCISES: (Exercise & { chapter: number })[] = [];
export let EXERCISES_BY_ID = new Map<string, Exercise & { chapter: number }>();

let notes = new Map<number, string>();
let chapterById = new Map<string, number>();

export const getChapter = (n: number) => CHAPTERS.find((c) => c.number === n);
export const getNotes = (chapter: number) => notes.get(chapter);
export const hasNotes = (chapter: number) => notes.has(chapter);
export const chapterOf = (itemId: string) => chapterById.get(itemId);

/** Replace the current course. `unitNotes` maps unit number → notes Markdown. */
export function setCourse(outline: CourseOutline, content: CourseContent, unitNotes: Map<number, string>) {
  const book = validateBook(content.chapters);
  const errors = [...book.errors];
  for (const c of book.chapters) {
    const md = unitNotes.get(c.number);
    if (!md) continue;
    for (const s of c.sections) {
      if (!extractNoteSection(md, { section: s.id })) errors.push({ where: `Chapter ${c.number} notes`, message: `no heading for section ${s.id}` });
    }
    for (const item of [...c.questions, ...c.exercises]) {
      if (item.noteAnchor && !extractNoteSection(md, { anchor: item.noteAnchor })) {
        errors.push({ where: `Chapter ${c.number} › ${item.id}`, message: `noteAnchor "${item.noteAnchor}" is not a heading in the notes` });
      }
    }
  }

  SUBJECT = { id: outline.slug, title: outline.title, short: outline.short, author: outline.author };
  TOC = outline.outline.map((u) => ({ number: u.number, title: u.title }));
  CHAPTERS = book.chapters;
  CONTENT_ERRORS = errors;
  ALL_QUESTIONS = CHAPTERS.flatMap((c) => c.questions);
  QUESTIONS_BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));
  ALL_EXERCISES = CHAPTERS.flatMap((c) => c.exercises.map((e) => ({ ...e, chapter: c.number })));
  EXERCISES_BY_ID = new Map(ALL_EXERCISES.map((e) => [e.id, e]));
  notes = unitNotes;
  chapterById = new Map();
  for (const c of CHAPTERS) {
    for (const q of c.questions) chapterById.set(q.id, c.number);
    for (const e of c.exercises) chapterById.set(e.id, c.number);
  }
}
