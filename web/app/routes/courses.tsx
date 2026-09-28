import { useRef } from "react";
import { Link } from "react-router";
import { ArrowRightIcon, BookOpenIcon } from "lucide-react";
import type { Route } from "./+types/courses";
import { api } from "~/api/client";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { APP } from "~/config";
import { useListNav } from "~/hooks/use-hotkeys";
import { LIST_SHORTCUTS, type RouteHandle } from "~/lib/shortcuts";
import { flushWrites } from "~/state/progress-store";
import type { CourseSummary } from "~/api/types";

export async function clientLoader() {
  await flushWrites(); // counts should include what was just answered in a course
  return api.courses();
}

/** "3 learning · 12 due · 20 new", like the course home's Today card. */
function todayText({ learning, review, fresh }: CourseSummary["today"]): string {
  const parts = [[learning, "learning"], [review, "due"], [fresh, "new"]].filter(([n]) => n) as [number, string][];
  return parts.length ? `Today: ${parts.map(([n, label]) => `${n} ${label}`).join(" · ")}` : "Nothing to study today";
}

export function meta() {
  return [{ title: APP.name }, { name: "description", content: `${APP.tagline}: pick a course` }];
}

export const handle: RouteHandle = { screen: "Courses", shortcuts: LIST_SHORTCUTS };

export default function Courses({ loaderData }: Route.ComponentProps) {
  const { courses } = loaderData;
  const gridRef = useRef<HTMLUListElement>(null);
  useListNav(gridRef);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your courses</h1>
        <p className="text-sm text-muted-foreground">Each course keeps its own study queue, schedule and stats.</p>
      </header>

      {courses.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses yet. Add one under <code>courses/</code> and run <code>make import-content</code>.
        </p>
      ) : (
        <ul ref={gridRef} className="grid gap-3 sm:grid-cols-2">
          {courses.map((c) => (
            <li key={c.slug}>
              <Link
                to={`/c/${encodeURIComponent(c.slug)}`}
                data-nav
                className="group block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Card className="h-full transition-colors group-hover:bg-muted/40">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="leading-snug">{c.title}</CardTitle>
                      <Badge variant="secondary" className="shrink-0 font-mono">
                        {c.short}
                      </Badge>
                    </div>
                    {c.author ? <CardDescription>{c.author}</CardDescription> : null}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {c.description ? <p className="text-sm text-muted-foreground">{c.description}</p> : null}
                    <p className="text-sm font-medium tabular-nums">{todayText(c.today)}</p>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <BookOpenIcon className="size-4" aria-hidden />
                        {c.unitCount} {c.unitCount === 1 ? "unit" : "units"} · {c.questionCount} questions
                        {c.exerciseCount ? ` · ${c.exerciseCount} exercises` : ""}
                      </span>
                      <ArrowRightIcon className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = error instanceof Error ? error.message : "The course list couldn't be loaded.";
  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 p-6">
      <h1 className="font-semibold">Can't load your courses</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
