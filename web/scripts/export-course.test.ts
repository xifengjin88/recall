// One-off: export the bundled TLPI content as JSON for server/scripts/convert_ts_course.py,
// which writes courses/tlpi/. Run with EXPORT_COURSE_TO=<file.json>; skipped otherwise.

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHAPTERS, CONTENT_ERRORS, getNotes, SUBJECT, TOC } from "../app/content";

describe.skipIf(!process.env.EXPORT_COURSE_TO)("export bundled course", () => {
  it("writes the course as JSON", () => {
    expect(CONTENT_ERRORS).toEqual([]);
    const data = {
      subject: SUBJECT,
      toc: TOC,
      chapters: CHAPTERS.map((c) => ({ ...c, notes: getNotes(c.number) ?? null })),
    };
    writeFileSync(process.env.EXPORT_COURSE_TO!, JSON.stringify(data, null, 1));
  });
});
