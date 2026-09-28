// Type-level contract with the server: `npm run typecheck` fails if a real response (saved by
// server/tests/api/test_samples.py) no longer fits the types in ./types.ts.

import type { ExerciseState, ProgressData, SessionRecord } from "~/lib/progress";
import type {
  ApiErrorBody,
  CourseContent,
  CourseOutline,
  CoursesResponse,
  LearnerSettings,
  Previews,
  ReviewResult,
  SchedulingInfo,
  UnitNotes,
} from "./types";
import content from "./samples/content.json";
import course from "./samples/course.json";
import courses from "./samples/courses.json";
import error from "./samples/error.json";
import exercise from "./samples/exercise.json";
import notes from "./samples/notes.json";
import preview from "./samples/preview.json";
import progress from "./samples/progress.json";
import review from "./samples/review.json";
import scheduling from "./samples/scheduling.json";
import session from "./samples/session.json";
import settings from "./samples/settings.json";

// JSON imports widen string literals ("learning" → string), so objects with literal unions can't use
// `satisfies` directly. `Loose<T>` keeps every key and nesting but relaxes literals to string/number:
// a renamed or missing field still fails, and client.test.ts checks the values.
type Loose<T> = T extends number
  ? number
  : T extends string
    ? string
    : T extends (infer U)[]
      ? Loose<U>[]
      : T extends object
        ? { [K in keyof T]: Loose<T[K]> }
        : T;

export const samples = {
  courses: courses satisfies CoursesResponse,
  course: course satisfies CourseOutline,
  content: content as unknown as CourseContent, // question unions need a literal "type": checked by client.test.ts
  notes: notes satisfies UnitNotes,
  error: error satisfies ApiErrorBody,
  session: session satisfies Loose<SessionRecord> as SessionRecord,
  review: review satisfies Loose<ReviewResult> as ReviewResult,
  preview: preview satisfies Loose<Previews> as Previews,
  progress: progress satisfies Loose<ProgressData> as ProgressData,
  exercise: exercise satisfies Loose<ExerciseState> as ExerciseState,
  scheduling: scheduling satisfies Loose<SchedulingInfo> as SchedulingInfo,
  settings: settings satisfies Loose<LearnerSettings> as LearnerSettings,
};
