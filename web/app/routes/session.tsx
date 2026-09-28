import { APP } from "~/config";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CheckCircle2Icon, LightbulbIcon, XCircleIcon, XIcon } from "lucide-react";
import { AnswerInput, initialDraft, pickOption, toResponse, type Draft } from "~/components/answer-input";
import { CodeBlock } from "~/components/code-block";
import { KeyHint } from "~/components/kbd";
import { Md, MdLines } from "~/components/md";
import { NoteLink, type NoteTarget } from "~/components/note-link";
import { chapterForQuestion, SessionSummary, type ResultRow } from "~/components/session-summary";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Progress } from "~/components/ui/progress";
import type { Route } from "./+types/session";
import { api } from "~/api/client";
import { SUBJECT, CHAPTERS } from "~/content";
import { ensureCourse } from "~/content/load";
import { useHotkeys } from "~/hooks/use-hotkeys";
import { answerText, grade, responseText } from "~/lib/grade";
import { formatDue, RATINGS, type Card, type Rating } from "~/lib/cards";
import type { Previews } from "~/api/types";
import { makeRng, nextInSession, pickQuestions, present, specFromSearch, type SessionSpec } from "~/lib/session";
import type { RouteHandle } from "~/lib/shortcuts";
import type { Question } from "~/lib/types";
import { cn } from "~/lib/utils";
import {
  completeSession,
  getProgress,
  overrideReview,
  presetFor,
  previewCard,
  recordReview,
  startSession,
} from "~/state/progress-store";
import { coursePath } from "~/lib/paths";

const RATING_LABELS: Record<Rating, { label: string; key: string }> = {
  again: { label: "Again", key: "1" },
  hard: { label: "Hard", key: "2" },
  good: { label: "Good", key: "3" },
  easy: { label: "Easy", key: "4" },
};

export function meta() {
  return [{ title: `Session · ${APP.name}` }];
}

export const handle: RouteHandle = {
  screen: "Session",
  shortcuts: [
    { keys: ["1–9"], label: "Pick option N (toggles in multi-select)" },
    { keys: ["j", "k"], label: "Move between options" },
    { keys: ["Enter"], label: "Submit / next" },
    { keys: ["h"], label: "Reveal hint" },
    { keys: ["n"], label: "Open the note link (after answering)" },
    { keys: ["o"], label: '"I was right" (after a wrong typed answer)' },
    { keys: ["Shift", "J/K"], label: "Move an item (order questions)" },
    { keys: ["Space"], label: "Flip flashcard" },
    { keys: ["1", "2", "3", "4"], label: "Again · Hard · Good · Easy" },
    { keys: ["r"], label: "Retry missed (summary)" },
    { keys: ["Esc"], label: "Quit session" },
  ],
};

// Picks the session's questions once per URL. Filters and order are the app's; which cards are in
// today's queue (learning, due, new within the daily limits) is the server's answer.
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  await ensureCourse(params.course);
  const spec = specFromSearch(new URL(request.url).searchParams);
  const questions = await pickQuestions(CHAPTERS, spec, {
    cards: getProgress().cards,
    queue: (candidates) => api.queue(params.course, { kind: "question", candidates }),
  });
  return { questions };
}

export default function SessionRoute({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const key = params.toString();
  const spec = useMemo(() => specFromSearch(new URLSearchParams(key)), [key]);
  // A new search string (e.g. "Retry missed") is a new session.
  return <SessionRunner key={key} spec={spec} picked={loaderData.questions} />;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

function SessionRunner({ spec, picked }: { spec: SessionSpec; picked: Question[] }) {
  const navigate = useNavigate();
  const [questions] = useState(picked); // fixed for the session, even as answers change the queue
  const [sessionId] = useState(newId);
  const [startedAt] = useState(Date.now);
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [done, setDone] = useState<{ rows: ResultRow[]; elapsed: number } | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);

  useEffect(() => {
    if (questions.length) startSession(sessionId, spec.mode);
  }, [questions.length, sessionId, spec.mode]);

  const backTo = spec.chapter !== null ? coursePath(`/chapters/${spec.chapter}`) : coursePath();
  const finish = (final: ResultRow[]) => {
    completeSession(sessionId);
    setDone({ rows: final, elapsed: Date.now() - startedAt });
    window.scrollTo({ top: 0 });
  };

  if (!questions.length) {
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="font-medium">No questions match this session.</p>
        <p className="text-sm text-muted-foreground">Nothing is due, or the filters exclude everything.</p>
        <Button variant="outline" asChild>
          <Link to={backTo}>Go back</Link>
        </Button>
      </div>
    );
  }

  if (done) return <SessionSummary spec={spec} rows={done.rows} elapsed={done.elapsed} />;

  const answered = rows?.length ?? 0;
  const quit = (
    <Dialog open={quitOpen} onOpenChange={setQuitOpen}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Quit this session?</DialogTitle>
          <DialogDescription>
            {answered
              ? `Your ${answered} answer${answered === 1 ? " is" : "s are"} already saved.`
              : "You haven't answered anything yet."}{" "}
            The session won't count toward your streak.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep going</Button>
          </DialogClose>
          <Button variant="destructive" autoFocus onClick={() => navigate(backTo)}>
            Quit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const common = { spec, sessionId, questions, onRows: setRows, onFinish: finish, onQuit: () => setQuitOpen(true) };
  return (
    <>
      {spec.mode === "quiz" ? <Quiz {...common} /> : <Flashcards {...common} />}
      {quit}
    </>
  );
}

interface RunnerProps {
  spec: SessionSpec;
  sessionId: string;
  questions: Question[];
  onRows(rows: ResultRow[]): void;
  onFinish(rows: ResultRow[]): void;
  onQuit(): void;
}

/**
 * The session's card order: the picked questions, plus any card that drops back into
 * (re)learning, which returns once due (or early, when nothing else is left).
 */
function useSessionQueue(questions: Question[]) {
  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const learnAheadMs = presetFor("question").learnAheadMinutes * 60_000;
  const [pending, setPending] = useState(() => questions.map((q) => q.id));
  const [relearn, setRelearn] = useState<{ id: string; due: number }[]>([]);
  const [current, setCurrent] = useState(() => nextInSession(questions.map((q) => q.id), [], Date.now(), learnAheadMs));
  const [shown, setShown] = useState(0);

  const inLearning = (c: Card) => c.phase === "learning" || c.phase === "relearning";

  /** Move on after answering the current card; returns false when the session is over. */
  function advance(after: Card): boolean {
    const p = current?.from === "pending" ? pending.slice(1) : pending;
    let r = relearn.filter((x) => x.id !== after.id);
    if (inLearning(after)) r = [...r, { id: after.id, due: after.due }];
    const next = nextInSession(p, r, Date.now(), learnAheadMs);
    setPending(p);
    setRelearn(r);
    setCurrent(next);
    setShown((n) => n + 1);
    return next !== null;
  }

  /** An override can take the card out of relearning. */
  function reschedule(after: Card) {
    setRelearn((r) => {
      const rest = r.filter((x) => x.id !== after.id);
      return inLearning(after) ? [...rest, { id: after.id, due: after.due }] : rest;
    });
  }

  // The current card is still in `pending` or `relearn`, so it counts as remaining.
  const remaining = pending.length + relearn.length;
  return { q: current ? byId.get(current.id)! : null, shown, remaining, advance, reschedule };
}

function SessionHeader({
  answered,
  remaining,
  score,
  section,
  onQuit,
}: {
  answered: number;
  remaining: number;
  score?: string;
  section: string;
  onQuit(): void;
}) {
  const total = answered + remaining;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono tabular-nums" aria-label={`${answered} answered, ${remaining} left`}>
          {answered + 1} / {total}
        </span>
        {score ? <span className="text-muted-foreground tabular-nums">Score {score}</span> : null}
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">§{section}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onQuit}>
          <XIcon /> Quit <KeyHint>Esc</KeyHint>
        </Button>
      </div>
      <Progress value={total ? (answered / total) * 100 : 0} aria-label="Session progress" />
    </div>
  );
}

function Prompt({ q }: { q: Question }) {
  return (
    <div className="min-w-0 space-y-3">
      <h1 className="text-lg leading-snug font-medium text-balance">
        <Md text={q.prompt} />
      </h1>
      {q.code ? <CodeBlock code={q.code} /> : null}
    </div>
  );
}

function noteFor(q: Question): NoteTarget {
  return { chapter: chapterForQuestion(q.id)!.number, section: q.section, anchor: q.noteAnchor };
}

/** Score = first answers only; repeats of relearning cards don't count twice. */
function firstScore(rows: ResultRow[]) {
  const first = new Map<string, ResultRow>();
  for (const r of rows) if (!first.has(r.q.id)) first.set(r.q.id, r);
  const f = [...first.values()];
  return `${f.filter((r) => r.correct).length}/${f.length}`;
}

// ---- Quiz ---------------------------------------------------------------------

function Quiz({ spec, sessionId, questions, onRows, onFinish, onQuit }: RunnerProps) {
  const queue = useSessionQueue(questions);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [lastAfter, setLastAfter] = useState<Card | null>(null);
  const q = queue.q;

  const update = (next: ResultRow[]) => {
    setRows(next);
    onRows(next);
  };
  const next = () => {
    if (!lastAfter) return;
    if (!queue.advance(lastAfter)) onFinish(rows);
    setLastAfter(null);
  };
  if (!q) return null;

  return (
    <div className="space-y-6">
      <SessionHeader answered={queue.shown} remaining={queue.remaining} score={firstScore(rows)} section={q.section} onQuit={onQuit} />
      <QuizQuestion
        key={queue.shown}
        q={q}
        seed={spec.seed + queue.shown * 7919}
        reviewId={`${sessionId}:${queue.shown}`}
        sessionId={sessionId}
        onAnswered={(row) => {
          setLastAfter(row.after);
          update([...rows, row]);
        }}
        onOverride={(row) => {
          setLastAfter(row.after);
          queue.reschedule(row.after);
          update([...rows.slice(0, -1), row]);
        }}
        onNext={next}
        onQuit={onQuit}
      />
    </div>
  );
}

interface Answered {
  correct: boolean;
  overridden: boolean;
  before: Card;
  after: Card;
}

function QuizQuestion({
  q,
  seed,
  reviewId,
  sessionId,
  onAnswered,
  onOverride,
  onNext,
  onQuit,
}: {
  q: Question;
  seed: number;
  reviewId: string;
  sessionId: string;
  onAnswered(r: ResultRow): void;
  onOverride(r: ResultRow): void;
  onNext(): void;
  onQuit(): void;
}) {
  const pres = useMemo(() => present(q, makeRng(seed)), [q, seed]);
  const [draft, setDraft] = useState<Draft>(() => initialDraft(q, pres));
  const [hinted, setHinted] = useState(false);
  const [result, setResult] = useState<Answered | null>(null);
  const [answeredAt, setAnsweredAt] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const noteTarget = noteFor(q);
  const [noteOpen, setNoteOpen] = useState(false);
  const [shownAt] = useState(Date.now);

  const response = toResponse(q, draft);
  const isTyped = draft.kind === "text";

  useEffect(() => {
    if (result) nextRef.current?.focus();
  }, [result]);

  // While a rating is on its way to the server. A failed save shows the notice and leaves the
  // question answerable; retrying reuses the review id, so the server never counts it twice.
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (result || !response || saving) return;
    const correct = grade(q, response);
    const answer = responseText(response);
    // Quiz answers map onto the engine's ratings.
    const rating: Rating = !correct ? "again" : hinted ? "hard" : "good";
    setSaving(true);
    const saved = await recordReview({
      reviewId,
      cardId: q.id,
      kind: "question",
      source: "quiz",
      sessionId,
      rating,
      correct,
      answer,
      hinted,
      durationMs: Date.now() - shownAt,
    }).catch(() => null);
    setSaving(false);
    if (!saved) return;
    const { before, after } = saved;
    setAnsweredAt(Date.now());
    setResult({ correct, overridden: false, before, after });
    onAnswered({ q, correct, hinted, overridden: false, answer, rating, before, after });
  }

  async function override() {
    if (!result || result.correct || !isTyped || !response || saving) return;
    setSaving(true);
    const saved = await overrideReview(reviewId).catch(() => null);
    setSaving(false);
    if (!saved) return;
    const { before, after } = saved;
    setResult({ correct: true, overridden: true, before, after });
    onOverride({ q, correct: true, hinted, overridden: true, answer: responseText(response), rating: "hard", before, after });
  }

  const moveFocus = (delta: number) => {
    const items = [...(optionsRef.current?.querySelectorAll<HTMLElement>("[data-nav]:not([disabled])") ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[i === -1 ? (delta > 0 ? 0 : items.length - 1) : Math.max(0, Math.min(items.length - 1, i + delta))].focus();
  };

  const digitKeys = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [String(i + 1), () => !result && setDraft((d) => pickOption(d, pres, i + 1))]),
  );
  useHotkeys({
    ...digitKeys,
    j: () => !result && moveFocus(1),
    ArrowDown: () => !result && moveFocus(1),
    k: () => !result && moveFocus(-1),
    ArrowUp: () => !result && moveFocus(-1),
    h: () => !result && q.hint && setHinted(true),
    Enter: () => (result ? onNext() : submit()),
    n: () => result && setNoteOpen(true),
    o: override,
    Escape: onQuit,
  });

  return (
    <div className="space-y-5">
      <Prompt q={q} />

      <div ref={optionsRef}>
        <AnswerInput q={q} p={pres} draft={draft} onChange={setDraft} answered={!!result} correct={result?.correct} />
      </div>

      {q.hint && (hinted || !result) ? (
        <div className="text-sm">
          {hinted ? (
            <p className="flex gap-2 rounded-lg bg-muted px-3 py-2">
              <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <span>
                <Md text={q.hint} />
              </span>
            </p>
          ) : (
            <Button variant="link" size="sm" className="px-0" onClick={() => setHinted(true)}>
              <LightbulbIcon /> Show hint <KeyHint>h</KeyHint>
            </Button>
          )}
        </div>
      ) : null}

      {!result ? (
        <div className="flex justify-end">
          <Button size="lg" onClick={submit} disabled={!response || saving}>
            Check <KeyHint className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">Enter</KeyHint>
          </Button>
        </div>
      ) : (
        <section
          role="status"
          aria-live="polite"
          className={cn("space-y-3 rounded-lg border-l-4 bg-muted/40 p-4", result.correct ? "border-l-success" : "border-l-destructive")}
        >
          <p className={cn("flex flex-wrap items-center gap-2 font-semibold", result.correct ? "text-success" : "text-destructive")}>
            {result.correct ? <CheckCircle2Icon className="size-5" aria-hidden /> : <XCircleIcon className="size-5" aria-hidden />}
            {result.correct ? "Correct" : "Incorrect"}
            {result.overridden ? <span className="text-xs font-normal text-muted-foreground">(override: counted as Hard)</span> : null}
            {hinted && result.correct && !result.overridden ? (
              <span className="text-xs font-normal text-muted-foreground">(with hint: counted as Hard)</span>
            ) : null}
            <span className="ml-auto text-xs font-normal text-muted-foreground">Next review: {formatDue(result.after, answeredAt)}</span>
          </p>
          <p className="text-sm leading-relaxed">
            <Md text={q.explanation} />
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <NoteLink target={noteTarget} hotkey="n" open={noteOpen} onOpenChange={setNoteOpen}>
              See in notes
            </NoteLink>
            {!result.correct && isTyped ? (
              <Button variant="outline" size="sm" onClick={override} disabled={saving}>
                I was right <KeyHint>o</KeyHint>
              </Button>
            ) : null}
            <Button ref={nextRef} className="ml-auto" onClick={onNext}>
              Next
              <KeyHint className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">Enter</KeyHint>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

// ---- Flashcards ---------------------------------------------------------------

function Flashcards({ questions, sessionId, onRows, onFinish, onQuit }: RunnerProps) {
  const queue = useSessionQueue(questions);
  const [flipped, setFlipped] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [flippedAt, setFlippedAt] = useState(0);
  const [shownAt, setShownAt] = useState(Date.now);
  const q = queue.q;
  const [noteOpen, setNoteOpen] = useState(false);
  const cardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!flipped) cardRef.current?.focus();
  }, [queue.shown, flipped]);

  // What each button would schedule, like Anki's "<1m · 6m · 10m · 4d". The server computes
  // them; they're fetched while the front is showing so they're ready at the flip.
  const [previews, setPreviews] = useState<{ id: string; cards: Previews } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!q) return;
    let live = true;
    previewCard(q.id)
      .then((cards) => live && setPreviews({ id: q.id, cards }))
      .catch(() => {}); // labels are optional; rating still works
    return () => {
      live = false;
    };
  }, [q, queue.shown]);
  const labels = useMemo(() => {
    if (!q || !flipped || previews?.id !== q.id) return null;
    return Object.fromEntries(RATINGS.map((r) => [r, formatDue(previews.cards[r], flippedAt)])) as Record<Rating, string>;
  }, [q, flipped, flippedAt, previews]);

  const flip = () => {
    if (!flipped) setFlippedAt(Date.now());
    setFlipped((f) => !f);
  };

  async function rate(rating: Rating) {
    if (!flipped || !q || saving) return;
    setSaving(true);
    const saved = await recordReview({
      reviewId: `${sessionId}:${queue.shown}`,
      cardId: q.id,
      kind: "question",
      source: "flashcard",
      sessionId,
      rating,
      correct: rating !== "again",
      answer: rating,
      durationMs: Date.now() - shownAt,
    }).catch(() => null);
    setSaving(false);
    if (!saved) return;
    const { before, after } = saved;
    const nextRows = [...rows, { q, correct: rating !== "again", hinted: false, overridden: false, answer: rating, rating, before, after }];
    setRows(nextRows);
    onRows(nextRows);
    setFlipped(false);
    setShownAt(Date.now());
    if (!queue.advance(after)) onFinish(nextRows);
  }

  useHotkeys({
    " ": flip,
    Enter: () => !flipped && flip(),
    ...Object.fromEntries(RATINGS.map((r) => [RATING_LABELS[r].key, () => rate(r)])),
    n: () => flipped && setNoteOpen(true),
    Escape: onQuit,
  });

  if (!q) return null;

  const isChoice = q.type === "single" || q.type === "multi" || (q.type === "output" && !!q.options);

  return (
    <div className="space-y-6">
      <SessionHeader answered={queue.shown} remaining={queue.remaining} section={q.section} onQuit={onQuit} />

      <button
        ref={cardRef}
        type="button"
        onClick={flip}
        aria-label={flipped ? "Card back. Activate to show the front" : "Card front. Activate to reveal the answer"}
        className="block w-full rounded-xl border bg-card p-5 text-left shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="space-y-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">{flipped ? "Answer" : "Recall"}</p>
          <Prompt q={q} />
          {!flipped && isChoice ? <p className="text-xs text-muted-foreground">Recall the answer; the options are hidden.</p> : null}
          {flipped ? (
            <div className="space-y-3 border-t pt-3">
              <p className="font-medium text-success">
                <MdLines text={answerText(q)} />
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                <Md text={q.explanation} />
              </p>
            </div>
          ) : (
            <p className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
              Tap or press <KeyHint className="inline-flex">Space</KeyHint> to flip
            </p>
          )}
        </div>
      </button>

      {flipped ? (
        <div className="space-y-4">
          <NoteLink target={noteFor(q)} hotkey="n" open={noteOpen} onOpenChange={setNoteOpen} />
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="How well did you recall it?">
            {RATINGS.map((r) => (
              <Button
                key={r}
                variant={r === "again" ? "destructive" : r === "good" ? "default" : "outline"}
                className="h-14 flex-col gap-0.5"
                disabled={saving}
                onClick={() => rate(r)}
              >
                <span className="font-mono text-[0.7rem] opacity-80">{labels?.[r]}</span>
                {RATING_LABELS[r].label}
                <span className="font-mono text-[0.65rem] opacity-60" aria-hidden>
                  {RATING_LABELS[r].key}
                </span>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
