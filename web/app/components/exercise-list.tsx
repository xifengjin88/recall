import { useRef } from "react";
import { Link } from "react-router";
import { CheckCircle2Icon, CircleDashedIcon, CircleDotIcon, SkipForwardIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { SUBJECT } from "~/content";
import { useListNav } from "~/hooks/use-hotkeys";
import { NEW_EXERCISE, type ExerciseStatus } from "~/lib/progress";
import type { Exercise } from "~/lib/types";
import { cn } from "~/lib/utils";
import { useProgress } from "~/state/progress-store";
import { coursePath } from "~/lib/paths";

export const EXERCISE_STATUS: Record<ExerciseStatus, { label: string; icon: typeof CheckCircle2Icon; className: string }> = {
  "not-started": { label: "Not started", icon: CircleDashedIcon, className: "text-muted-foreground" },
  "in-progress": { label: "In progress", icon: CircleDotIcon, className: "" },
  done: { label: "Done", icon: CheckCircle2Icon, className: "border-success/40 text-success" },
  skipped: { label: "Skipped", icon: SkipForwardIcon, className: "text-muted-foreground" },
};

export function ExerciseStatusChip({ status }: { status: ExerciseStatus }) {
  const s = EXERCISE_STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", s.className)}>
      <s.icon aria-hidden />
      {s.label}
    </Badge>
  );
}

export const difficultyLabel = (d: number) => ["", "Easy", "Medium", "Hard"][d] ?? String(d);

/** `nav` = handle j/k itself; turn off when a page shows several lists under one navigator. */
export function ExerciseList({ exercises, nav = true }: { exercises: Exercise[]; nav?: boolean }) {
  const progress = useProgress();
  const listRef = useRef<HTMLUListElement>(null);
  useListNav(listRef, nav);
  if (!exercises.length) return <p className="text-sm text-muted-foreground">No exercises yet.</p>;
  return (
    <ul ref={listRef} className="divide-y rounded-lg border">
      {exercises.map((e) => {
        const status = (progress.exercises[e.id] ?? NEW_EXERCISE).status;
        return (
          <li key={e.id}>
            <Link
              to={coursePath(`/exercises/${e.id}`)}
              data-nav
              className="flex flex-col gap-1.5 px-4 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{e.title}</span>
                <ExerciseStatusChip status={status} />
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {e.bookRef ? (
                  <span className="font-mono">
                    {SUBJECT.short} {e.bookRef}
                  </span>
                ) : null}
                <span className="font-mono">§{e.sections.join(", §")}</span>
                <span>{difficultyLabel(e.difficulty)}</span>
                {e.estimate ? <span>~{e.estimate}</span> : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
