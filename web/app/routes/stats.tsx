import { APP } from "~/config";
import { Link } from "react-router";
import { MasteryBar } from "~/components/mastery-bar";
import { Md } from "~/components/md";
import { Card, CardContent } from "~/components/ui/card";
import { SUBJECT, CHAPTERS, chapterOf, QUESTIONS_BY_ID } from "~/content";
import { formatDay, today } from "~/lib/dates";
import { resolvePreset } from "~/lib/engine";
import { mastery, sectionMastery } from "~/lib/mastery";
import type { RouteHandle } from "~/lib/shortcuts";
import { accuracyByDay, forecast, studyDays, weakest } from "~/lib/stats";
import { cn } from "~/lib/utils";
import { useProgress } from "~/state/progress-store";
import { coursePath } from "~/lib/paths";

export function meta() {
  return [{ title: `Stats · ${APP.name}` }];
}

export const handle: RouteHandle = { screen: "Stats", shortcuts: [] };

export default function Stats() {
  const p = useProgress();
  const days = accuracyByDay(p.reviews);
  const weak = weakest(p.reviews).filter((w) => QUESTIONS_BY_ID.has(w.cardId));
  const cards = Object.values(p.cards);
  const upcoming = forecast(cards, today());
  const leeches = cards.filter((c) => c.leech && QUESTIONS_BY_ID.has(c.id));

  const totals = [
    { label: "Reviews", value: p.reviews.length },
    { label: "Sessions completed", value: p.sessions.filter((s) => s.completedAt).length },
    { label: "Study days", value: studyDays(p.reviews) },
    { label: "Exercises done", value: Object.values(p.exercises).filter((e) => e.status === "done").length },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
        {totals.map((t) => (
          <Card key={t.label} size="sm">
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
              <p className="text-xs text-muted-foreground">{t.label}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Accuracy per day</h2>
        {days.length ? (
          <Bars
            label="Accuracy per day"
            scale={100}
            gridLabel="%"
            rows={days.slice(-21).map((d) => {
              const pct = Math.round((d.correct / d.total) * 100);
              return { key: d.day, name: formatDay(d.day), value: pct, detail: `${d.correct}/${d.total} correct · ${pct}%` };
            })}
            columns={["Correct", "Accuracy"]}
            cells={(r) => {
              const d = days.find((x) => x.day === r.key)!;
              return [`${d.correct}/${d.total}`, `${r.value}%`];
            }}
          />
        ) : (
          <Empty>Answer some questions to see your accuracy here.</Empty>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Reviews due, next 14 days</h2>
        {upcoming.some((d) => d.count) ? (
          <Bars
            label="Reviews due per day"
            scale={Math.max(...upcoming.map((d) => d.count))}
            rows={upcoming.map((d, i) => ({
              key: d.day,
              name: i === 0 ? "Today" : formatDay(d.day),
              value: d.count,
              detail: `${d.count} due${i === 0 ? " (incl. overdue)" : ""}`,
            }))}
            columns={["Due"]}
            cells={(r) => [String(r.value)]}
          />
        ) : (
          <Empty>Nothing scheduled yet.</Empty>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Mastery</h2>
        {CHAPTERS.map((c) => (
          <div key={c.number} className="space-y-2 rounded-lg border p-4">
            <div className="grid gap-1.5 sm:grid-cols-[1fr_14rem] sm:items-center">
              <Link to={coursePath(`/chapters/${c.number}`)} className="font-medium hover:underline">
                {c.number}. {c.title}
              </Link>
              <MasteryBar m={mastery(c.questions, p.cards)} label={`Chapter ${c.number} mastery`} />
            </div>
            <ul className="space-y-1.5 border-t pt-2">
              {c.sections
                .filter((s) => c.questions.some((q) => q.section === s.id && !q.retired))
                .map((s) => (
                  <li key={s.id} className="grid gap-1 text-sm sm:grid-cols-[1fr_14rem] sm:items-center">
                    <span className="min-w-0 truncate text-muted-foreground">
                      <span className="mr-2 font-mono">{s.id}</span>
                      {s.title}
                    </span>
                    <MasteryBar m={sectionMastery(c, s.id, p.cards)} label={`Section ${s.id} mastery`} />
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Weakest questions</h2>
        {weak.length ? (
          <ol className="divide-y rounded-lg border">
            {weak.map((w) => {
              const q = QUESTIONS_BY_ID.get(w.cardId)!;
              return (
                <li key={w.cardId} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">§{q.section}</span>
                  <Link to={coursePath(`/chapters/${chapterOf(q.id)}`)} className="min-w-0 flex-1 hover:underline">
                    <Md text={q.prompt} />
                  </Link>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {w.wrong}/{w.total} wrong
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty>No wrong answers yet.</Empty>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Leeches</h2>
        <p className="text-sm text-muted-foreground">
          Cards forgotten {resolvePreset("question", p.settings.scheduling).leechLapses}+ times. Worth rewriting, or re-reading the notes for.
        </p>
        {leeches.length ? (
          <ul className="divide-y rounded-lg border">
            {leeches.map((c) => {
              const q = QUESTIONS_BY_ID.get(c.id)!;
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">§{q.section}</span>
                  <Link to={coursePath(`/chapters/${chapterOf(q.id)}`)} className="min-w-0 flex-1 hover:underline">
                    <Md text={q.prompt} />
                  </Link>
                  <span className="shrink-0 font-mono text-xs tabular-nums">{c.lapses} lapses</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>No leeches.</Empty>
        )}
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

interface BarRow {
  key: string;
  name: string;
  value: number;
  detail: string;
}

/** Single-series bar chart: one ink color, no legend; hover/focus tooltip per bar; table view. */
function Bars({
  label,
  rows,
  scale,
  gridLabel = "",
  columns,
  cells,
}: {
  label: string;
  rows: BarRow[];
  scale: number;
  gridLabel?: string;
  columns: string[];
  cells(r: BarRow): string[];
}) {
  const max = Math.max(scale, 1);
  return (
    <figure className="space-y-2">
      <div className="relative rounded-lg border p-4 pt-6">
        {/* recessive gridlines at half and full scale */}
        <div className="pointer-events-none absolute inset-x-4 top-6 bottom-10" aria-hidden>
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
          <span className="absolute -top-4 right-0 text-[0.65rem] text-muted-foreground">
            {max}
            {gridLabel}
          </span>
        </div>
        <div className="flex h-40 items-end gap-0.5" role="img" aria-label={`${label}, bar chart. See the table below for values.`}>
          {rows.map((r) => (
            <div
              key={r.key}
              tabIndex={0}
              className="group relative flex h-full min-w-0 flex-1 items-end justify-center outline-none"
              aria-label={`${r.name}: ${r.detail}`}
            >
              <div
                className="w-full max-w-6 rounded-t-[4px] bg-foreground/80 transition-colors group-hover:bg-foreground group-focus-visible:bg-foreground"
                style={{ height: `${r.value ? Math.max((r.value / max) * 100, 2) : 0}%` }}
              />
              <div
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md",
                  "group-hover:block group-focus-visible:block",
                )}
              >
                <span className="font-medium">{r.name}</span>
                <br />
                {r.detail}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[0.65rem] text-muted-foreground">
          <span>{rows[0]?.name}</span>
          {rows.length > 1 ? <span>{rows[rows.length - 1].name}</span> : null}
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Day</th>
              {columns.map((c) => (
                <th key={c} className="py-1 text-right font-normal">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((r) => (
              <tr key={r.key} className="border-t">
                <td className="py-1 font-sans">{r.name}</td>
                {cells(r).map((c, i) => (
                  <td key={i} className="py-1 text-right">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
