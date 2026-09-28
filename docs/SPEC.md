# Recall: Product Spec

A spaced-repetition study app, currently loaded with *The Linux Programming Interface* (Michael Kerrisk). The product (name and branding in `app/config.ts`) is kept separate from the subject (`app/content/subject.ts`), so it can later be white-labelled and hold many subjects. It drills the concepts from each chapter with quizzes and flashcards, and tracks hands-on C exercises from later chapters.

This spec describes **what** the app does and **how it should behave**. It deliberately leaves out technology, architecture and code (for those, see `CLAUDE.md`).

- **Version:** 0.1 (Chapter 2 content, no exercises yet)
- **Companion files (not yet in the repo):**
  - `tlpi-ch02-question-bank.md`: the Chapter 2 question set, written to the content schema in §5
  - `TLPI 02 - Fundamental Concepts.md`: the study note that questions link back to. It's embedded in the app as `app/content/notes/ch02.md`

---

## 1. Goals

1. **Recall, not recognition.** Make the reader retrieve facts and reason about them, through quizzes, typed answers and "predict the output" questions.
2. **Come back at the right time.** Resurface missed and older material with simple spaced repetition, so Chapter 2 stays fresh by Chapter 30.
3. **Grow with the book.** Adding a chapter's questions or exercises must be a **content-only change**. Adding a chapter never requires changing app behavior.
4. **Tie back to the notes.** Every question and exercise points to the section of the study notes it came from. The notes are part of the app's content: a per-chapter notes page, plus a side panel that shows one section without leaving a session.
5. **Keyboard first.** Every action must be doable without a mouse, and still work fully by touch on a phone.

### Non-goals (v1)
- User accounts, sync between devices, or a server-side database
- Compiling or running C in the app (exercises are done in your own terminal)
- AI grading or generated questions at runtime
- Reproducing text from the book beyond short terms and definitions

---

## 2. Core concepts (glossary)

| Term | Meaning |
|---|---|
| **Book** | TLPI. The app holds one book, but nothing should assume the book title in more than one place. |
| **Chapter** | A numbered chapter, e.g. 2 "Fundamental Concepts". Has sections. |
| **Section** | A numbered section, e.g. 2.4. The smallest unit questions are tagged with. |
| **Item** | Anything the learner studies: a *question* or an *exercise*. |
| **Question** | A single quiz item with one of the types in §5.3. Also used as a flashcard. |
| **Exercise** | A hands-on programming task (§5.4). Tracked, not auto-graded. |
| **Session** | One run of quiz or flashcard questions, from start to the summary screen. |
| **Card** | The scheduling state of one question or exercise: phase, interval, ease, due (§6). |
| **Review** | One rating of one card, from a quiz answer, a flashcard or a finished exercise. |
| **Mastery** | A percentage per section and chapter derived from card intervals (§6.3). |

---

## 3. Screens

### 3.1 Home (dashboard)
Shows at a glance where you are and what to do next.

- **Today:** Anki-style counts of learning, due and new cards in today's queue, with a primary action **Study now**. If the queue is empty, show when the next card is due.
- **Exercises to redo:** finished exercises whose redo has come due.
- **Streak:** consecutive days with at least one completed session.
- **Chapter list:** one row per chapter that has content, showing
  - chapter number and title
  - mastery % (a bar or ring)
  - counts: questions, exercises, exercises done
  - status chip: *Not started*, *In progress*, *Mastered* (≥ 80% mastery)
- Chapters in the book with **no content yet** appear dimmed as "Coming soon", so the full table of contents is visible.
- **Continue** shortcut to the last chapter used.

### 3.2 Chapter page
- Title, section list, and a link to the chapter's Obsidian note.
- Each section row: section number, title, question count, mastery %.
- Actions:
  - **Quiz**: opens session setup (§3.3) scoped to this chapter
  - **Flashcards**: same, in flashcard mode
  - **Review mistakes**: questions from this chapter answered wrong in their most recent attempt
  - **Exercises** tab (hidden when the chapter has none)
- Selecting a section scopes quiz/flashcards to that section only.

### 3.3 Session setup
A small panel (not a separate page) with sensible defaults, so pressing Enter starts immediately.

| Option | Choices | Default |
|---|---|---|
| Scope | This chapter · selected sections · all chapters · due only · mistakes only | from the entry point |
| Length | 10 · 20 · all | 10 |
| Order | shuffled · book order | shuffled |
| Types | any subset of question types | all |
| Difficulty | 1 · 2 · 3 · any | any |

Options are remembered between sessions.

### 3.4 Quiz session
One question at a time.

- **Header:** progress (`7 / 20`), current score, the section tag (`§2.7`), and a quit control.
- **Body:** prompt, optional code or terminal block (monospaced, preserved whitespace, horizontally scrollable), then the answer input for the question type.
- **Before answering:** optional **Hint** (reveals the hint and marks the attempt "hinted"; see §6).
- **After answering:**
  - clear correct/incorrect state, shown by more than color alone (icon and text)
  - the correct answer is highlighted, and so is the learner's wrong choice
  - the **explanation**
  - **See in notes →** link to the source section
  - **Next** action
- For typed answers, a **"I was right"** override appears after an incorrect result (for typos or equivalent wording). Using it counts as correct but is recorded as overridden.
- Options for choice questions are shuffled each time (unless the question says not to).
- Quitting mid-session asks for confirmation inside the page and keeps the answers given so far.

### 3.5 Session summary
- Score (e.g. `16 / 20`, 80%) and time taken
- Breakdown by section: correct / total
- List of missed questions, each expandable to show the prompt, your answer, the right answer and the explanation
- Actions: **Retry missed**, **New session**, **Back to chapter**
- What the session changed (e.g. "8 scheduled further out · 2 forgotten (relearning) · 1 still learning")

### 3.6 Flashcards
- **Front:** the prompt (plus code block if any). For choice questions, the options are **not** shown; the learner recalls the answer.
- **Back:** correct answer + explanation + note link.
- Flip with a key or tap. Then rate: **Again · Hard · Good · Easy** (§6.2).
- Progress indicator and a summary at the end like §3.5.

### 3.7 Exercises (per chapter, and an "All exercises" list)
**List view:** title, related sections, difficulty, estimated time, book reference (e.g. "TLPI 4-1"), and status: *Not started · In progress · Done · Skipped*.

**Exercise detail:**
- Goal and background
- Numbered requirements
- Constraints (e.g. "only `open`, `read`, `write`, `close`; no stdio")
- Example terminal session showing commands and expected output
- **Test checklist:** each test case shows the command/input and the expected result. The learner ticks each one off after running it themselves.
- **Hints**, revealed one at a time (hint 1, then 2, …). The app records how many were revealed.
- Stretch goals
- A free-text **My notes** field (e.g. where the solution lives, what went wrong)
- Link to the Obsidian note section
- Status control. Marking **Done** is only offered once every test case is ticked (the learner can still choose *Skipped*).

### 3.8 Stats
- Mastery per chapter and per section
- Accuracy over time (per day)
- Weakest 10 questions (most often wrong)
- Totals: questions answered, sessions, study days, exercises done

### 3.9 Settings
- Theme: light / dark / follow system
- Show keyboard hints on screen: on/off
- Default session length and order
- **Export progress** to a file, and **Import progress** from a file (replace or merge)
- **Reset progress** for one chapter or everything, with an in-page confirmation step

### 3.10 Keyboard help overlay
Opened with `?`. Lists every shortcut for the current screen.

---

## 4. Keyboard map

Mouse and touch equivalents exist for everything. Shortcuts are disabled while typing in a text field, except `Enter` and `Esc`.

| Key | Where | Action |
|---|---|---|
| `j` / `k` or ↓ / ↑ | lists, options | move selection |
| `1`–`9` | choice question | pick option N (toggle for multi-select) |
| `Enter` | anywhere | confirm / submit / next |
| `Space` | flashcards | flip |
| `1` `2` `3` `4` | flashcard back | Again · Hard · Good · Easy |
| `h` | question | reveal hint |
| `n` | after answering | open the note link |
| `o` | after a wrong typed answer | "I was right" override |
| `r` | summary | retry missed |
| `g h` | anywhere | go home |
| `g s` | anywhere | go to stats |
| `Esc` | session | quit (with confirmation) / close overlay |
| `?` | anywhere | keyboard help |

---

## 5. Content

All study material lives **outside the app's logic**, as content organized **one set per chapter**. The app discovers whatever chapters exist. Adding Chapter 3 means adding Chapter 3's content and nothing else.

### 5.1 Chapter

| Field | Required | Notes |
|---|---|---|
| `number` | yes | e.g. `2` |
| `title` | yes | "Fundamental Concepts" |
| `note` | yes | Obsidian note name, e.g. `TLPI 02 - Fundamental Concepts` |
| `sections` | yes | ordered list of `{ id: "2.4", title: "Single Directory Hierarchy, Directories, Links, and Files" }` |
| `questions` | no | list of questions (§5.2) |
| `exercises` | no | list of exercises (§5.4) |

The app also knows the **full table of contents** (chapter numbers and titles only) so empty chapters can show as "Coming soon".

### 5.2 Question (common fields)

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable and unique forever, e.g. `ch02-q014`. **Never reused or renumbered**, because progress is keyed on it. |
| `type` | yes | one of §5.3 |
| `section` | yes | a section id from the chapter, e.g. `2.7` |
| `prompt` | yes | the question text; may contain inline code |
| `code` | no | a code or terminal block shown under the prompt, with a language label (`c`, `bash`, `text`) |
| `explanation` | yes | why the answer is right; 1–3 sentences |
| `hint` | no | nudges without giving the answer away |
| `difficulty` | yes | 1 = recall a fact, 2 = apply or distinguish, 3 = reason through a scenario |
| `tags` | no | free labels, e.g. `signals`, `permissions`, `gotcha` |
| `noteAnchor` | no | heading in the note to link to; defaults to the section heading |
| `retired` | no | if true, the question is hidden but its history is kept |

### 5.3 Question types

| Type | Input | Type-specific fields | Correct when |
|---|---|---|---|
| `single` | pick one option | `options` (2–6), `answer` (one option) | the chosen option is the answer |
| `multi` | pick all that apply | `options`, `answers` (1+ options) | the chosen set **exactly** equals the answers (no partial credit) |
| `truefalse` | true / false | `answer` (true/false) | matches |
| `typed` | short free text | `accept` (list of accepted answers), `caseSensitive` (default false) | the input, after trimming and collapsing spaces, matches any accepted answer |
| `output` | predict what a command or program prints | `code`, then either `options`+`answer` or `accept` | as `single` or `typed` |
| `order` | arrange items into the right sequence | `items` in correct order | the full order matches |
| `match` | pair terms with definitions | `pairs` (3–6) | every pair is correct |

`single`, `multi` and `order` may set `keepOrder: true` when shuffling would break the question (e.g. "0, 1, 2, 3").

### 5.4 Exercise

| Field | Required | Notes |
|---|---|---|
| `id` | yes | stable, e.g. `ch04-ex01` |
| `title` | yes | e.g. "Write your own `tee`" |
| `sections` | yes | related section ids |
| `bookRef` | no | the book's own exercise number, e.g. `4-1` |
| `difficulty` | yes | 1–3 |
| `estimate` | no | e.g. "45 min" |
| `goal` | yes | one paragraph |
| `background` | no | concepts to recall first, with note links |
| `requirements` | yes | numbered list |
| `constraints` | no | list |
| `example` | no | a terminal session: commands and expected output |
| `tests` | yes | list of `{ name, run, expect }`, where `expect` can describe stdout, stderr, exit status and file effects |
| `hints` | no | ordered list, revealed one at a time |
| `stretch` | no | list of extra challenges |

### 5.5 Content rules
When the app loads content it checks it and shows a clear, readable **content error list** (in development, and in a small warning banner otherwise) for:
- duplicate ids anywhere in the book
- a `section` that isn't in the chapter's section list
- `answer`/`answers` not among the `options`
- `multi` with no answers, `match` with fewer than 3 pairs, empty `accept` list
- missing required fields

A broken question is skipped; it must never crash a session.

---

## 6. Learning rules

One scheduling engine (Anki's classic SM-2 variant, `recall_engine` on the server) drives quizzes, flashcards **and** exercises. The app sends each rating to the server, which schedules the card and answers with the result. Content never talks to it directly: each item is a *card* of a *kind* (question or exercise), and each kind has a *preset* of options. The scheduler sits behind an interface so it can be swapped (e.g. for FSRS).

### 6.1 Ratings
Every review ends in one of **Again · Hard · Good · Easy**.

| Source | How the rating is produced |
|---|---|
| Quiz | wrong → Again; correct with a hint or by "I was right" override → Hard; correct → Good |
| Flashcard | the button pressed (buttons show what each would schedule, e.g. `1m · 6m · 10m · 4d`) |
| Exercise | the learner's self-rating when finishing an attempt, with a suggested rating (Hard if hints were used or it took over twice the estimate, else Good) |

A question's quiz and flashcard reviews share one card.

### 6.2 Scheduling (Anki classic defaults)
- **New / learning:** steps `1m 10m`. Again → first step; Hard → repeat (first step: average of the first two); Good → next step, graduating to review at **1 day**; Easy → review at **4 days**. Ease is untouched.
- **Review:** Hard → interval × 1.2, ease −15 pts; Good → interval × ease; Easy → interval × ease × 1.3, ease +15 pts. Each is at least a day longer than the previous interval and than the rating below it. Late answers get credit (Hard +¼, Good +½, Easy all of the late days). Answers before the due date grow from the days actually elapsed and never shorten the interval. Intervals are fuzzed slightly so cards spread out.
- **Lapse (Again on review):** ease −20 pts (floor 130%), interval × new-interval factor (0% → minimum 1 day), relearning step `10m`, then back to review. 8 lapses tags a **leech**.
- **Cards that fall back into (re)learning return within the same session** when due, or early (within 20 minutes) when nothing else is left.
- **Study day** starts at 4am local time.
- **Today's queue:** due learning cards, then due reviews (max 200/day), then new cards (20/day).
- **Exercises** use their own preset: no minute steps (first rating: Again 1d · Hard 2d · Good 3d · Easy 7d), lapses halve the interval, max 1 new and 2 redos a day. When a redo is due the learner chooses a **full redo** (ticks and hints reset, notes kept) or a **quick review** (sketch the approach in notes, then rate). Skipping an exercise suspends its card.
- Every option is configurable per kind in **Settings › Scheduling**, like Anki's deck options. Changes apply to future answers.

### 6.3 Mastery
- A question counts as **mastered** when its card is in review with an interval of **21 days or more** (Anki's "mature").
- **Section mastery** = mastered ÷ active questions in the section. **Chapter mastery** = the same over the chapter. Retired questions don't count.

### 6.4 Review log
Every rating is appended to a review log: card, source, session, time, rating, graded correct/incorrect, hint and override flags, the answer given, the card's state before and after, and time taken. Stats (§3.8), streaks, leeches and the daily limits are all computed from it.

### 6.5 Streak
A day counts if at least one session (or exercise rating) was **completed** that study day. Missing a day resets the streak to 0.

---

## 7. Progress data

- Stored by the **Recall server** in PostgreSQL, per learner and per course. Times are stored in UTC; the learner's time zone (reported by the browser) decides where study days start.
- Keyed by item `id`, so adding, editing or reordering content never loses progress. Editing a question's wording keeps its card and history. Retiring one hides it but keeps the history.
- **Export** produces one file with all cards, reviews, sessions, exercise state, notes and settings. **Import** accepts that file (or an export from the earlier box-based version, which is converted) with a choice of *replace* or *merge* (merge keeps the most recent record per item).
- Progress saved in the browser by earlier versions (IndexedDB `recall-<course>`, or the first version's localStorage) is copied to the server automatically the first time a course is opened. The browser copy is kept as a backup, and the app says when it's done.
- If a change can't reach the server, the app says so; ratings are safe to retry (each has an id, so none is counted twice).

---

## 8. Look and feel

- Content-first and calm: one question in focus, generous spacing, monospaced type for code, terminal output, paths, syscalls and signal names.
- Light and dark themes, both fully readable.
- Correct/incorrect states use icon + text + color, never color alone.
- Works at phone width (≈ 380 px): code blocks scroll sideways inside their box; the page itself never does.
- Visible keyboard focus everywhere; respects reduced-motion settings; option buttons are large enough to tap.

---

## 9. Acceptance criteria (v1)

1. With only the Chapter 2 content present, Home lists Chapter 2 with its questions and shows other chapters as "Coming soon".
2. A 10-question shuffled quiz can be completed using only the keyboard.
3. Each question type in §5.3 renders, accepts input and is marked correctly, including `multi` exact-set checking and `typed` answers with different case and extra spaces.
4. After answering, the explanation and a working link to the note section are shown.
5. Answering wrong sends the card to relearning (back within the session after 10 minutes); a lapsed review card loses 20 ease points.
6. Retry missed from the summary starts a session containing exactly the missed questions.
7. Flashcard ratings schedule cards as in §6.2, and each button shows the interval it would give.
8. Section and chapter mastery match §6.3.
9. Adding a new chapter's content (questions only, no exercises) makes it appear on Home with no other change. Its Exercises tab stays hidden.
10. Adding an exercise to a chapter makes the Exercises tab appear. Ticking all tests enables *Done*, and status persists after reload.
11. Export, reset everything, then import restores identical progress.
12. A deliberately broken question (answer not in options) shows up in the content error list and is skipped in sessions.
13. Changing a question's wording keeps its card and history.
15. Finishing an exercise asks for a rating; the exercise shows up under "Exercises to redo" when due.
16. Scheduling options changed in Settings are used by the next answer.
14. Usable at 380 px wide in both themes.

---

## 10. Roadmap

| Version | Adds |
|---|---|
| 0.1 | Chapter 2 questions and notes, quiz, flashcards, Anki-style scheduling engine (also for exercises), IndexedDB storage, configurable scheduling, stats, export/import |
| 0.2 | Chapter 3 content; first `output` questions based on C snippets |
| 0.3 | Chapters 4–5 (file I/O) with the first exercises: `tee`, `cp` with holes, `dup`/`dup2` via `fcntl` |
| later | Search across questions; "exam mode" (no feedback until the end, timed); per-tag practice (e.g. all `signals` questions across chapters) |
