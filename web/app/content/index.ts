import { extractNoteSection } from "~/lib/notes";
import { validateBook } from "~/lib/validate";
import type { Chapter } from "~/lib/types";

export { TOC } from "./toc";
export { SUBJECT } from "./subject";

// Chapters are discovered, not registered: adding app/content/ch03.ts is the whole
// change needed to add Chapter 3 (spec §1.3). Each file default-exports a Chapter.
const modules = import.meta.glob<{ default: Chapter }>("./ch[0-9]*.ts", { eager: true });

const book = validateBook(Object.values(modules).map((m) => m.default));

export const CHAPTERS = book.chapters;
export const CONTENT_ERRORS = book.errors;

// Study notes: app/content/notes/chNN.md (Obsidian-flavoured markdown). Optional per chapter.
const noteFiles = import.meta.glob<string>("./notes/ch[0-9]*.md", { query: "?raw", import: "default", eager: true });
const NOTES = new Map<number, string>(
  Object.entries(noteFiles).map(([path, md]) => [Number(/ch(\d+)\.md$/.exec(path)![1]), md]),
);
export const getNotes = (chapter: number) => NOTES.get(chapter);
export const hasNotes = (chapter: number) => NOTES.has(chapter);

// Every section and custom noteAnchor should have a heading to link to.
for (const c of CHAPTERS) {
  const md = NOTES.get(c.number);
  if (!md) continue;
  for (const s of c.sections) {
    if (!extractNoteSection(md, { section: s.id })) {
      CONTENT_ERRORS.push({ where: `Chapter ${c.number} notes`, message: `no heading for section ${s.id}` });
    }
  }
  for (const item of [...c.questions, ...c.exercises]) {
    if (item.noteAnchor && !extractNoteSection(md, { anchor: item.noteAnchor })) {
      CONTENT_ERRORS.push({ where: `Chapter ${c.number} › ${item.id}`, message: `noteAnchor "${item.noteAnchor}" is not a heading in the notes` });
    }
  }
}

export const getChapter = (n: number) => CHAPTERS.find((c) => c.number === n);

export const ALL_QUESTIONS = CHAPTERS.flatMap((c) => c.questions);
export const QUESTIONS_BY_ID = new Map(ALL_QUESTIONS.map((q) => [q.id, q]));

export const ALL_EXERCISES = CHAPTERS.flatMap((c) => c.exercises.map((e) => ({ ...e, chapter: c.number })));
export const EXERCISES_BY_ID = new Map(ALL_EXERCISES.map((e) => [e.id, e]));

const chapterById = new Map<string, number>();
for (const c of CHAPTERS) {
  for (const q of c.questions) chapterById.set(q.id, c.number);
  for (const e of c.exercises) chapterById.set(e.id, c.number);
}
export const chapterOf = (itemId: string) => chapterById.get(itemId);
