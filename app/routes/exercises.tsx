import { APP } from "~/config";
import { useRef } from "react";
import { Link } from "react-router";
import { ExerciseList } from "~/components/exercise-list";
import { SUBJECT, CHAPTERS } from "~/content";
import { useListNav } from "~/hooks/use-hotkeys";
import { LIST_SHORTCUTS, type RouteHandle } from "~/lib/shortcuts";

export function meta() {
  return [{ title: `Exercises · ${APP.name}` }];
}

export const handle: RouteHandle = { screen: "Exercises", shortcuts: LIST_SHORTCUTS };

export default function Exercises() {
  const withExercises = CHAPTERS.filter((c) => c.exercises.length);
  const all = withExercises.flatMap((c) => c.exercises);
  const listsRef = useRef<HTMLDivElement>(null);
  useListNav(listsRef);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">All exercises</h1>
        <p className="text-sm text-muted-foreground">
          Hands-on C programs. Build them in your own terminal, then tick off the tests here.
        </p>
      </header>
      {all.length ? (
        <div ref={listsRef} className="space-y-6">
          {withExercises.map((c) => (
            <section key={c.number} className="space-y-2">
              <h2 className="text-sm font-medium">
                <Link to={`/chapters/${c.number}?tab=exercises`} className="hover:underline">
                  Chapter {c.number}: {c.title}
                </Link>
              </h2>
              <ExerciseList exercises={c.exercises} nav={false} />
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No exercises yet. The first ones arrive with the file I/O chapters (4–5).
        </p>
      )}
    </div>
  );
}
