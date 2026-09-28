// Golden cases for server/src/recall_content/notes.py, produced by this app's note helpers.
//   GEN_GOLDEN=1 npx vitest run scripts/gen-notes-golden.test.ts   # (re)write
//   npm test                                                      # check it is current

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractNoteSection, headingId, noteToc } from "../app/lib/notes";

const OUT = fileURLToPath(new URL("../../server/tests/content/golden/notes.json", import.meta.url));
const NOTES_COPY = fileURLToPath(new URL("../../server/tests/content/golden/ch02-notes.md", import.meta.url));
const CH02 = readFileSync(fileURLToPath(new URL("../../courses/tlpi/units/02-fundamental-concepts/notes.md", import.meta.url)), "utf8");

const HEADINGS = [
  "2.7 Processes",
  "2.10 Interprocess communication and synchronization",
  "  2.1 The core operating system: the kernel",
  "Process view vs kernel view",
  "Capabilities",
  "The `init` process",
  "Self-test",
  "Further reading (from the chapter)",
  "Kernel **mode** and _user_ mode",
  "12. Not a section",
  "2.4",
  "  --weird--  ",
];

function render(): string {
  const sections = Array.from({ length: 20 }, (_, i) => `2.${i + 1}`);
  const anchors = ["Capabilities", "Process view vs kernel view", "The init process", "Nope"];
  const data = {
    generator: "web/scripts/gen-notes-golden.test.ts",
    headingIds: HEADINGS.map((text) => ({ text, id: headingId(text) })),
    ch02: {
      toc: noteToc(CH02),
      sections: sections.map((section) => ({ section, markdown: extractNoteSection(CH02, { section }) })),
      anchors: anchors.map((anchor) => ({ anchor, markdown: extractNoteSection(CH02, { anchor }) })),
    },
  };
  return JSON.stringify(data, null, 1) + "\n";
}

describe("notes golden file", () => {
  it(process.env.GEN_GOLDEN ? "writes server/tests/content/golden/notes.json" : "is up to date with the app's note helpers", () => {
    const text = render();
    if (process.env.GEN_GOLDEN) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, text);
      writeFileSync(NOTES_COPY, CH02); // the Python tests' input
    }
    expect(readFileSync(OUT, "utf8")).toBe(text);
    expect(readFileSync(NOTES_COPY, "utf8")).toBe(CH02);
  });
});
