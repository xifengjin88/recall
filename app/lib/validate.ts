import type { Chapter, Exercise, LoadedChapter, Question } from "./types";

export interface ContentError {
  /** Where the problem is, e.g. "Chapter 2 › ch02-q014". */
  where: string;
  message: string;
}

export interface ValidatedBook {
  chapters: LoadedChapter[];
  errors: ContentError[];
}

type Loose = Record<string, unknown>;

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function checkQuestion(q: Loose, sectionIds: Set<string>): string[] {
  const errs: string[] = [];
  for (const f of ["id", "type", "section", "prompt", "explanation"]) {
    if (!isStr(q[f])) errs.push(`missing required field "${f}"`);
  }
  if (![1, 2, 3].includes(q.difficulty as number)) errs.push(`"difficulty" must be 1, 2 or 3`);
  if (isStr(q.section) && !sectionIds.has(q.section)) errs.push(`section "${q.section}" is not in the chapter's section list`);

  const checkOptions = (): string[] | null => {
    if (!isStrList(q.options) || q.options.length < 2 || q.options.length > 6) {
      errs.push(`"options" must list 2–6 strings`);
      return null;
    }
    if (new Set(q.options).size !== q.options.length) errs.push(`"options" contains duplicates`);
    return q.options;
  };
  const checkSingleAnswer = () => {
    const opts = checkOptions();
    if (!isStr(q.answer)) errs.push(`missing required field "answer"`);
    else if (opts && !opts.includes(q.answer)) errs.push(`answer "${q.answer}" is not among the options`);
  };
  const checkAccept = () => {
    if (!isStrList(q.accept) || q.accept.filter((a) => a.trim() !== "").length === 0) errs.push(`"accept" list is empty`);
  };

  switch (q.type) {
    case "single":
      checkSingleAnswer();
      break;
    case "multi": {
      const opts = checkOptions();
      if (!isStrList(q.answers) || q.answers.length === 0) errs.push(`multi question has no answers`);
      else if (opts) for (const a of q.answers) if (!opts.includes(a)) errs.push(`answer "${a}" is not among the options`);
      break;
    }
    case "truefalse":
      if (typeof q.answer !== "boolean") errs.push(`"answer" must be true or false`);
      break;
    case "typed":
      checkAccept();
      break;
    case "output": {
      const code = q.code as Loose | undefined;
      if (!code || !isStr(code.source)) errs.push(`output question needs a "code" block`);
      if (q.options !== undefined) checkSingleAnswer();
      else checkAccept();
      break;
    }
    case "order":
      if (!isStrList(q.items) || q.items.length < 2) errs.push(`"items" must list at least 2 strings`);
      else if (new Set(q.items).size !== q.items.length) errs.push(`"items" contains duplicates`);
      break;
    case "match": {
      const pairs = q.pairs as Loose[] | undefined;
      if (!Array.isArray(pairs) || pairs.length < 3 || pairs.length > 6) errs.push(`match needs 3–6 pairs`);
      else {
        if (!pairs.every((p) => isStr(p?.term) && isStr(p?.definition))) errs.push(`every pair needs a "term" and a "definition"`);
        if (new Set(pairs.map((p) => p?.definition)).size !== pairs.length) errs.push(`match definitions must be distinct`);
      }
      break;
    }
    default:
      if (isStr(q.type)) errs.push(`unknown question type "${q.type}"`);
  }
  return errs;
}

function checkExercise(e: Loose, sectionIds: Set<string>): string[] {
  const errs: string[] = [];
  for (const f of ["id", "title", "goal"]) if (!isStr(e[f])) errs.push(`missing required field "${f}"`);
  if (![1, 2, 3].includes(e.difficulty as number)) errs.push(`"difficulty" must be 1, 2 or 3`);
  if (!isStrList(e.sections) || e.sections.length === 0) errs.push(`missing required field "sections"`);
  else for (const s of e.sections) if (!sectionIds.has(s)) errs.push(`section "${s}" is not in the chapter's section list`);
  if (!isStrList(e.requirements) || e.requirements.length === 0) errs.push(`missing required field "requirements"`);
  const tests = e.tests as Loose[] | undefined;
  if (!Array.isArray(tests) || tests.length === 0) errs.push(`missing required field "tests"`);
  else {
    if (!tests.every((t) => isStr(t?.name) && isStr(t?.run) && isStr(t?.expect))) errs.push(`every test needs "name", "run" and "expect"`);
    if (new Set(tests.map((t) => t?.name)).size !== tests.length) errs.push(`test names must be unique`);
  }
  return errs;
}

/**
 * Checks every chapter against the content rules (spec §5.5). Broken questions and
 * exercises are dropped from the result and reported; a broken chapter is dropped whole.
 */
export function validateBook(input: unknown[]): ValidatedBook {
  const errors: ContentError[] = [];
  const chapters: LoadedChapter[] = [];
  const seenIds = new Map<string, string>(); // id -> where it was first seen

  for (const raw of input) {
    const ch = (raw ?? {}) as Loose;
    const label = typeof ch.number === "number" ? `Chapter ${ch.number}` : "Chapter ?";
    const chErrs: string[] = [];
    if (typeof ch.number !== "number") chErrs.push(`missing required field "number"`);
    for (const f of ["title", "note"]) if (!isStr(ch[f])) chErrs.push(`missing required field "${f}"`);
    const sections = ch.sections as Loose[] | undefined;
    if (!Array.isArray(sections) || sections.length === 0 || !sections.every((s) => isStr(s?.id) && isStr(s?.title))) {
      chErrs.push(`"sections" must be a non-empty list of { id, title }`);
    }
    if (typeof ch.number === "number" && chapters.some((c) => c.number === ch.number)) chErrs.push(`chapter number defined twice`);
    if (chErrs.length) {
      for (const message of chErrs) errors.push({ where: label, message });
      continue;
    }
    const chapter = ch as unknown as Chapter;
    const sectionIds = new Set(chapter.sections.map((s) => s.id));

    const takeId = (id: unknown, where: string): boolean => {
      if (!isStr(id)) return true; // reported as a missing field elsewhere
      const prev = seenIds.get(id);
      if (prev) {
        errors.push({ where, message: `duplicate id (also used in ${prev})` });
        return false;
      }
      seenIds.set(id, label);
      return true;
    };

    const questions: Question[] = [];
    (Array.isArray(ch.questions) ? (ch.questions as Loose[]) : []).forEach((q, i) => {
      const where = `${label} › ${isStr(q?.id) ? q.id : `question #${i + 1}`}`;
      const errs = checkQuestion(q ?? {}, sectionIds);
      const unique = takeId(q?.id, where);
      for (const message of errs) errors.push({ where, message });
      if (!errs.length && unique) questions.push(q as unknown as Question);
    });

    const exercises: Exercise[] = [];
    (Array.isArray(ch.exercises) ? (ch.exercises as Loose[]) : []).forEach((e, i) => {
      const where = `${label} › ${isStr(e?.id) ? e.id : `exercise #${i + 1}`}`;
      const errs = checkExercise(e ?? {}, sectionIds);
      const unique = takeId(e?.id, where);
      for (const message of errs) errors.push({ where, message });
      if (!errs.length && unique) exercises.push(e as unknown as Exercise);
    });

    chapters.push({ ...chapter, questions, exercises });
  }

  chapters.sort((a, b) => a.number - b.number);
  return { chapters, errors };
}
