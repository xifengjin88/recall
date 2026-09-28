import { APP } from "~/config";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, FlameIcon, WrenchIcon } from "lucide-react";
import { KeyHint } from "~/components/kbd";
import { MasteryBar } from "~/components/mastery-bar";
import { SessionSetup, type SetupEntry } from "~/components/session-setup";
import { StatusChip } from "~/components/status-chip";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { ALL_EXERCISES, CHAPTERS, SUBJECT, getChapter, TOC } from "~/content";
import { useHotkeys, useListNav } from "~/hooks/use-hotkeys";
import { formatDay, studyDay, today } from "~/lib/dates";
import { formatWait } from "~/lib/cards";
import { chapterStatus, mastery } from "~/lib/mastery";
import { LIST_SHORTCUTS, type RouteHandle } from "~/lib/shortcuts";
import { streak } from "~/lib/stats";
import { cn } from "~/lib/utils";
import { flushWrites, useProgress } from "~/state/progress-store";
import { api } from "~/api/client";
import { ensureCourse } from "~/content/load";
import type { Route } from "./+types/home";
import { coursePath } from "~/lib/paths";

export const handle: RouteHandle = {
  screen: "Home",
  shortcuts: [{ keys: ["r"], label: "Study today's queue" }, { keys: ["c"], label: "Continue last chapter" }, ...LIST_SHORTCUTS],
};

// Today's counts come from the server; they refresh each time the course home is opened.
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await ensureCourse(params.course);
  await flushWrites(); // e.g. the session just finished
  return { today: await api.today(params.course) };
}

export function meta() {
  return [{ title: `${APP.name}` }];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const progress = useProgress();
  const day = today();
  const [setup, setSetup] = useState<SetupEntry | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  useListNav(listRef);

  const now = Date.now();
  const q = loaderData.today;
  const redo = q.redo.map((id) => ALL_EXERCISES.find((e) => e.id === id)).filter((e) => e !== undefined);
  const dueNow = q.learning.length + q.review.length;
  const total = dueNow + q.fresh.length;
  const nextDue = q.nextDue;
  const days = streak(progress.sessions, day);
  const last = progress.lastChapter !== null ? getChapter(progress.lastChapter) : undefined;

  const startReview = () => total > 0 && setSetup({ mode: "quiz", scope: "today", chapter: null });
  useHotkeys({ r: startReview, c: () => last && listRef.current?.querySelector<HTMLElement>(`[data-chapter="${last.number}"]`)?.click() });

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            <div className="mr-auto space-y-1">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Today</p>
              <dl className="flex gap-5 tabular-nums">
                <Count label="learning" value={q.learning.length} />
                <Count label="due" value={q.review.length} />
                <Count label="new" value={q.fresh.length} />
              </dl>
              <p className="text-sm text-muted-foreground">
                {total > 0
                  ? `${total} card${total === 1 ? "" : "s"} in today's queue`
                  : nextDue !== null
                    ? `All done. Next: ${studyDay(nextDue) === today(now) ? `in ${formatWait(nextDue - now)}` : formatDay(studyDay(nextDue))}`
                    : "Nothing left today."}
              </p>
            </div>
            <Button size="lg" onClick={startReview} disabled={total === 0}>
              Study now <KeyHint className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">r</KeyHint>
            </Button>
          </CardContent>
        </Card>
        <Card className="sm:w-40">
          <CardContent className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-0">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">Streak</p>
            <p className="flex items-center gap-1.5 text-3xl font-semibold tabular-nums">
              <FlameIcon className={cn("size-6", days > 0 ? "text-orange-500" : "text-muted-foreground")} aria-hidden />
              {days}
            </p>
            <p className="text-sm text-muted-foreground">day{days === 1 ? "" : "s"}</p>
          </CardContent>
        </Card>
      </section>

      {redo.length ? (
        <section className="space-y-2" aria-labelledby="redo-h">
          <h2 id="redo-h" className="flex items-center gap-2 text-sm font-medium">
            <WrenchIcon className="size-4" aria-hidden /> Exercises to redo
          </h2>
          <ul className="divide-y rounded-lg border">
            {redo.map((e) => (
              <li key={e.id}>
                <Link to={coursePath(`/exercises/${e.id}`)} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/60">
                  <span>{e.title.replace(/`/g, "")}</span>
                  <ArrowRightIcon className="size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {last ? (
        <Link
          to={coursePath(`/chapters/${last.number}`)}
          className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-muted"
        >
          <span>
            <span className="text-muted-foreground">Continue: </span>
            Chapter {last.number}, {last.title}
          </span>
          <span className="flex items-center gap-2">
            <KeyHint>c</KeyHint>
            <ArrowRightIcon className="size-4" aria-hidden />
          </span>
        </Link>
      ) : null}

      <section aria-labelledby="chapters-h" className="space-y-3">
        <h2 id="chapters-h" className="text-sm font-medium text-muted-foreground">
          {SUBJECT.title}
        </h2>
        <ol ref={listRef} className="divide-y rounded-lg border">
          {TOC.map((t) => {
            const ch = getChapter(t.number);
            if (!ch) {
              return (
                <li key={t.number} className="flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground/60">
                  <span className="w-6 font-mono tabular-nums">{t.number}</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs">Coming soon</span>
                </li>
              );
            }
            const m = mastery(ch.questions, progress.cards);
            const exDone = ch.exercises.filter((e) => progress.exercises[e.id]?.status === "done").length;
            return (
              <li key={t.number}>
                <Link
                  to={coursePath(`/chapters/${ch.number}`)}
                  data-nav
                  data-chapter={ch.number}
                  className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1.5 px-4 py-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="font-mono font-medium tabular-nums">{ch.number}</span>
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{ch.title}</span>
                    <StatusChip status={chapterStatus(ch, progress.cards, progress.exercises)} />
                  </span>
                  <span />
                  <span className="grid gap-1.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                    <MasteryBar m={m} label={`Chapter ${ch.number} mastery`} />
                    <span className="flex gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">{m.total} questions</Badge>
                      {ch.exercises.length ? (
                        <Badge variant="outline">
                          {exDone}/{ch.exercises.length} exercises
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <SessionSetup entry={setup} onOpenChange={(o) => !o && setSetup(null)} />
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-3xl font-semibold">
        {value}
        <span className="ml-1 text-xs font-normal text-muted-foreground" aria-hidden>
          {label}
        </span>
      </dd>
    </div>
  );
}
