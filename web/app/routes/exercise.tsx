import { APP } from "~/config";
import { data, Link } from "react-router";
import { ArrowLeftIcon, LightbulbIcon } from "lucide-react";
import type { Route } from "./+types/exercise";
import { ensureCourse } from "~/content/load";
import { CodeBlock } from "~/components/code-block";
import { difficultyLabel, ExerciseStatusChip } from "~/components/exercise-list";
import { ExerciseReview, RedoBanner } from "~/components/exercise-review";
import { KeyHint } from "~/components/kbd";
import { Md } from "~/components/md";
import { NoteLink } from "~/components/note-link";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { SUBJECT, EXERCISES_BY_ID, getChapter } from "~/content";
import { useHotkeys } from "~/hooks/use-hotkeys";
import { NEW_EXERCISE } from "~/lib/progress";
import type { RouteHandle } from "~/lib/shortcuts";
import { updateExercise, useProgress } from "~/state/progress-store";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await ensureCourse(params.course); // loaders run in parallel with the course layout's
  const exercise = EXERCISES_BY_ID.get(params.id);
  if (!exercise) throw data("Exercise not found", { status: 404 });
  return { exercise, chapter: getChapter(exercise.chapter)! };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `${loaderData.exercise.title.replace(/`/g, "")} · ${APP.name}` : "Not found" }];
}

export const handle: RouteHandle = {
  screen: "Exercise",
  shortcuts: [
    { keys: ["h"], label: "Reveal the next hint" },
    { keys: ["n"], label: "Open the note" },
    { keys: ["Space"], label: "Tick the focused test" },
  ],
};

export default function ExercisePage({ loaderData }: Route.ComponentProps) {
  const { exercise: ex, chapter } = loaderData;
  const progress = useProgress();
  const state = progress.exercises[ex.id] ?? NEW_EXERCISE;
  const allTicked = ex.tests.every((t) => state.testsPassed.includes(t.name));
  const hints = ex.hints ?? [];

  const toggleTest = (name: string, on: boolean) => {
    const testsPassed = on ? [...state.testsPassed, name] : state.testsPassed.filter((n) => n !== name);
    updateExercise(ex.id, { testsPassed });
  };
  const revealHint = () => state.hintsRevealed < hints.length && updateExercise(ex.id, { hintsRevealed: state.hintsRevealed + 1 });

  useHotkeys({
    h: revealHint,
    n: () => document.querySelector<HTMLAnchorElement>("[data-exercise-note] button")?.click(),
  });

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <Link
          to={`/chapters/${chapter.number}?tab=exercises`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" /> Chapter {chapter.number}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Md text={ex.title} />
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <ExerciseStatusChip status={state.status} />
          {ex.bookRef ? (
            <span className="font-mono">
              {SUBJECT.short} {ex.bookRef}
            </span>
          ) : null}
          <span className="font-mono">§{ex.sections.join(", §")}</span>
          <span>{difficultyLabel(ex.difficulty)}</span>
          {ex.estimate ? <span>~{ex.estimate}</span> : null}
        </div>
        <RedoBanner ex={ex} state={state} card={progress.cards[ex.id]} />
        {state.attempt !== "first" && state.status === "in-progress" ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            {state.attempt === "redo" ? "Redo in progress: tests and hints were reset; your notes are kept." : "Quick review in progress."}
          </p>
        ) : null}
        <span data-exercise-note>
          <NoteLink target={{ chapter: chapter.number, section: ex.sections[0], anchor: ex.noteAnchor }} hotkey="n">
            See in notes
          </NoteLink>
        </span>
      </header>

      <Block title="Goal">
        <p className="leading-relaxed">
          <Md text={ex.goal} />
        </p>
      </Block>

      {ex.background?.length ? (
        <Block title="Background">
          <ul className="list-disc space-y-1 pl-5">
            {ex.background.map((b, i) => (
              <li key={i}>
                <Md text={b} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title="Requirements">
        <ol className="list-decimal space-y-1.5 pl-5">
          {ex.requirements.map((r, i) => (
            <li key={i}>
              <Md text={r} />
            </li>
          ))}
        </ol>
      </Block>

      {ex.constraints?.length ? (
        <Block title="Constraints">
          <ul className="list-disc space-y-1 pl-5">
            {ex.constraints.map((c, i) => (
              <li key={i}>
                <Md text={c} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {ex.example ? (
        <Block title="Example">
          <CodeBlock code={ex.example} />
        </Block>
      ) : null}

      <Block title={`Tests (${state.testsPassed.filter((n) => ex.tests.some((t) => t.name === n)).length}/${ex.tests.length})`}>
        <p className="text-sm text-muted-foreground">Run each one yourself, then tick it off.</p>
        <ul className="space-y-2">
          {ex.tests.map((t, i) => {
            const id = `test-${i}`;
            return (
              <li key={t.name} className="flex gap-3 rounded-lg border p-3">
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  checked={state.testsPassed.includes(t.name)}
                  onCheckedChange={(c) => toggleTest(t.name, c === true)}
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor={id} className="font-medium">
                    <Md text={t.name} />
                  </Label>
                  <pre className="overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs">
                    <code>{t.run}</code>
                  </pre>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Expect: </span>
                    <Md text={t.expect} />
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </Block>

      {hints.length ? (
        <Block title="Hints">
          <ol className="space-y-2">
            {hints.slice(0, state.hintsRevealed).map((h, i) => (
              <li key={i} className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <span>
                  <span className="font-medium">Hint {i + 1}. </span>
                  <Md text={h} />
                </span>
              </li>
            ))}
          </ol>
          {state.hintsRevealed < hints.length ? (
            <Button variant="outline" size="sm" onClick={revealHint}>
              <LightbulbIcon /> Show hint {state.hintsRevealed + 1} of {hints.length} <KeyHint>h</KeyHint>
            </Button>
          ) : null}
        </Block>
      ) : null}

      {ex.stretch?.length ? (
        <Block title="Stretch goals">
          <ul className="list-disc space-y-1 pl-5">
            {ex.stretch.map((s, i) => (
              <li key={i}>
                <Md text={s} />
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <Block title="My notes">
        <Textarea
          aria-label="My notes"
          placeholder="Where the solution lives, what went wrong, what you learned…"
          value={state.notes}
          onChange={(e) => updateExercise(ex.id, { notes: e.target.value })}
          className="min-h-28"
        />
      </Block>

      <Block title={state.attempt === "first" ? "Finish" : state.attempt === "redo" ? "Finish the redo" : "Quick review"}>
        <ExerciseReview ex={ex} state={state} allTicked={allTicked} />
      </Block>
    </article>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}
