# Ideas

Future directions for Recall. Not specced or planned yet; each needs its own `SPEC-<module>.md` before any code.

## 1. Generate a course from PDFs

Upload one or more PDFs (a book, lecture slides, papers); Recall extracts the content and drafts a course: notes, quiz questions, flashcards, and exercises when the material is programming-specific.

**How it could fit what exists**
- The output is an ordinary course folder (`course.yaml`, `units/*/{unit.yaml, questions.yaml, exercises.yaml, notes.md}`), so validation, import, retiring and progress all work unchanged.
- Pipeline: PDF → text + layout (pages, headings, code blocks, figures) → split into units and sections → an LLM drafts notes and items per section → `recall content validate` → the learner reviews → import.
- Keep a **draft/review step**: generated items land as drafts the learner can accept, edit or drop before they reach the study queue. Bad cards are worse than no cards.
- Exercises only when the source has code or the course is marked as programming; otherwise quizzes and flashcards.

**Open questions**
- Where it runs: a CLI first (`recall content generate book.pdf`), then an upload page?
- Which model and what it costs per book; can generation resume after a failure mid-book?
- Scanned PDFs (OCR), tables, math, diagrams.
- Re-running on a new edition without losing progress: item keys are permanent, so generated keys must be stable (e.g. derived from section + content, not a counter).
- Copyright: courses stay private to the learner who uploaded the PDF.

## 2. Show where content came from in the PDF

Every note section, question and flashcard links back to the page (and ideally the passage) it was generated from, so the learner can fact-check it.

**How it could fit**
- Store a `source` on sections and items: `{file, page, quote or bounding box}`. It's optional, so hand-written courses keep working. This is a content-format change: ask first (AGENTS.md).
- The answer/explanation view gets a "Source: p. 142" link that opens the PDF at that page, with the passage highlighted.
- The PDFs are kept (object storage or disk) next to the course and served by the API.
- A quote that doesn't appear on the cited page is a generation error the validator can catch automatically.
- "Report a problem" on a card: mark it wrong and retire or fix it, with the source side by side.

**Open questions**
- Page-level links only, or passage highlighting (needs text positions from extraction)?
- In-app PDF viewer (pdf.js) or open the file in a new tab?

## 3. Subjects beyond programming and text

Support study material that isn't text or code: e.g. languages (audio, pronunciation), music, art history and anatomy (images), maths (formulas, diagrams), geography (maps), physical skills.

**To work out together** (you and Claude, before any spec):
- Which subjects you actually want to study first; design from real use, not a general framework.
- New item types each needs, e.g. image occlusion (hide part of a diagram), audio prompt / audio answer, formula input, "draw or place on a map", self-graded practice with a timer.
- Media storage and serving (images, audio, video), and how media is authored in the course files.
- Whether the SM-2 scheduler and the four ratings still fit, or some kinds need their own presets (like exercises have today).
- How the PDF generation (idea 1) extends to non-text sources: images, slides, audio transcripts.

**Next step:** pick one or two concrete subjects, list what studying them looks like day to day, then write a capability map for the new item types.
