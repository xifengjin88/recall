// Type-level contract with the server: `npm run typecheck` fails if a real response (saved by
// server/tests/api/test_samples.py) no longer fits the types in ./types.ts.

import type { ApiErrorBody, CourseContent, CourseOutline, CoursesResponse, UnitNotes } from "./types";
import content from "./samples/content.json";
import course from "./samples/course.json";
import courses from "./samples/courses.json";
import error from "./samples/error.json";
import notes from "./samples/notes.json";

export const samples = {
  courses: courses satisfies CoursesResponse,
  course: course satisfies CourseOutline,
  content: content as unknown as CourseContent, // question unions need a literal "type": checked by client.test.ts
  notes: notes satisfies UnitNotes,
  error: error satisfies ApiErrorBody,
};
