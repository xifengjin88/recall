// Content schema (spec §5). Content files are authored against these types, but
// they are still validated at runtime (validate.ts) because the type system can't
// catch things like "answer is not one of the options".

export type Difficulty = 1 | 2 | 3;

export interface Section {
  id: string; // "2.4"
  title: string;
}

export interface CodeBlock {
  lang: "c" | "bash" | "text";
  source: string;
}

interface QuestionBase {
  /** Permanent: progress is keyed on it. Never renumber or reuse. */
  id: string;
  section: string;
  prompt: string;
  code?: CodeBlock;
  explanation: string;
  hint?: string;
  difficulty: Difficulty;
  tags?: string[];
  /** A heading in the chapter's study notes to link to; defaults to the section's heading. */
  noteAnchor?: string;
  retired?: boolean;
}

export interface SingleQuestion extends QuestionBase {
  type: "single";
  options: string[];
  answer: string;
  keepOrder?: boolean;
}

export interface MultiQuestion extends QuestionBase {
  type: "multi";
  options: string[];
  answers: string[];
  keepOrder?: boolean;
}

export interface TrueFalseQuestion extends QuestionBase {
  type: "truefalse";
  answer: boolean;
}

export interface TypedQuestion extends QuestionBase {
  type: "typed";
  accept: string[];
  caseSensitive?: boolean;
}

export type OutputQuestion = QuestionBase & { type: "output"; code: CodeBlock } & (
    | { options: string[]; answer: string; keepOrder?: boolean; accept?: never }
    | { accept: string[]; caseSensitive?: boolean; options?: never }
  );

export interface OrderQuestion extends QuestionBase {
  type: "order";
  /** In the correct order. */
  items: string[];
}

export interface MatchQuestion extends QuestionBase {
  type: "match";
  pairs: { term: string; definition: string }[];
}

export type Question =
  | SingleQuestion
  | MultiQuestion
  | TrueFalseQuestion
  | TypedQuestion
  | OutputQuestion
  | OrderQuestion
  | MatchQuestion;

export type QuestionType = Question["type"];

export const QUESTION_TYPES: { type: QuestionType; label: string }[] = [
  { type: "single", label: "Single choice" },
  { type: "multi", label: "Multiple choice" },
  { type: "truefalse", label: "True / false" },
  { type: "typed", label: "Typed answer" },
  { type: "output", label: "Predict output" },
  { type: "order", label: "Order" },
  { type: "match", label: "Match" },
];

export interface ExerciseTest {
  name: string;
  run: string;
  expect: string;
}

export interface Exercise {
  id: string;
  title: string;
  sections: string[];
  bookRef?: string;
  difficulty: Difficulty;
  estimate?: string;
  goal: string;
  background?: string[];
  requirements: string[];
  constraints?: string[];
  example?: CodeBlock;
  tests: ExerciseTest[];
  hints?: string[];
  stretch?: string[];
  noteAnchor?: string;
}

export interface Chapter {
  number: number;
  title: string;
  /** Note name, e.g. "TLPI 02 - Fundamental Concepts". The notes themselves are in content/notes/chNN.md. */
  note: string;
  sections: Section[];
  questions?: Question[];
  exercises?: Exercise[];
}

/** A chapter after validation: broken items removed, lists always present. */
export interface LoadedChapter extends Omit<Chapter, "questions" | "exercises"> {
  questions: Question[];
  exercises: Exercise[];
}

export interface TocEntry {
  number: number;
  title: string;
}

export function isChoice(q: Question): q is SingleQuestion | MultiQuestion | (OutputQuestion & { options: string[] }) {
  return q.type === "single" || q.type === "multi" || (q.type === "output" && Array.isArray(q.options));
}
