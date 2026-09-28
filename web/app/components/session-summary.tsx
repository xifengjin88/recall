import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeftIcon, ChevronDownIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { CHAPTERS, getChapter } from "~/content";
import { useHotkeys } from "~/hooks/use-hotkeys";
import { answerText } from "~/lib/grade";
import { newSeed, specToSearch, type SessionSpec } from "~/lib/session";
import { formatDue, type Card as EngineCard, type Rating } from "~/lib/cards";
import type { Question } from "~/lib/types";
import { KeyHint } from "./kbd";
import { Md, MdLines } from "./md";
import { NoteLink } from "./note-link";
import { SessionSetup, type SetupEntry } from "./session-setup";
import { coursePath } from "~/lib/paths";

/** One answer in a session. A card in relearning can appear more than once. */
export interface ResultRow {
  q: Question;
  correct: boolean;
  hinted: boolean;
  overridden: boolean;
  answer: string;
  rating: Rating;
  before: EngineCard;
  after: EngineCard;
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function chapterForQuestion(id: string) {
  return CHAPTERS.find((c) => c.questions.some((q) => q.id === id));
}

export function SessionSummary({ spec, rows, elapsed }: { spec: SessionSpec; rows: ResultRow[]; elapsed: number }) {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupEntry | null>(null);

  // Score from first answers; the card's last answer tells where it ended up.
  const first = new Map<string, ResultRow>();
  const last = new Map<string, ResultRow>();
  for (const r of rows) {
    if (!first.has(r.q.id)) first.set(r.q.id, r);
    last.set(r.q.id, r);
  }
  const firsts = [...first.values()];
  const correct = firsts.filter((r) => r.correct).length;
  const pct = firsts.length ? Math.round((correct / firsts.length) * 100) : 0;
  const missedIds = firsts.filter((r) => !r.correct).map((r) => r.q.id);
  const missed = missedIds.map((id) => first.get(id)!);

  const bySection = new Map<string, { correct: number; total: number }>();
  for (const r of firsts) {
    const s = bySection.get(r.q.section) ?? { correct: 0, total: 0 };
    s.total++;
    if (r.correct) s.correct++;
    bySection.set(r.q.section, s);
  }
  const sectionKeys = [...bySection.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const ends = firsts.map((r) => ({ before: r.before, after: last.get(r.q.id)!.after }));
  const learning = ends.filter((e) => e.after.phase === "learning" || e.after.phase === "relearning").length;
  const lapsed = ends.filter((e) => e.before.phase === "review" && e.after.lapses > e.before.lapses).length;
  const further = ends.filter((e) => e.after.phase === "review" && e.after.lapses === e.before.lapses && e.after.interval > e.before.interval).length;

  const chapter = spec.chapter !== null ? getChapter(spec.chapter) : undefined;
  const backTo = chapter ? coursePath(`/chapters/${chapter.number}`) : coursePath();

  const retry = () => {
    if (!missedIds.length) return;
    navigate(coursePath(`/session${specToSearch({ ...spec, scope: "ids", ids: missedIds, order: "shuffled", seed: newSeed() })}`));
  };
  const newSession = () =>
    setSetup({
      mode: spec.mode,
      scope: spec.scope === "ids" ? (chapter ? "chapter" : "all") : spec.scope,
      chapter: spec.chapter,
      sections: spec.sections,
    });

  useHotkeys({ r: retry, s: newSession, b: () => navigate(backTo) });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{spec.mode === "quiz" ? "Quiz" : "Flashcards"} complete</p>
        <h1 className="text-3xl font-semibold tabular-nums">
          {correct} / {firsts.length} <span className="text-muted-foreground">({pct}%)</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Time: {formatDuration(elapsed)} · {further} scheduled further out · {lapsed} forgotten (relearning) · {learning} still learning
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button onClick={retry} disabled={!missedIds.length} autoFocus={missedIds.length > 0}>
          <RotateCcwIcon /> Retry missed ({missedIds.length})
          <KeyHint className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">r</KeyHint>
        </Button>
        <Button variant="outline" onClick={newSession} autoFocus={!missedIds.length}>
          New session <KeyHint>s</KeyHint>
        </Button>
        <Button variant="ghost" asChild>
          <Link to={backTo}>
            <ArrowLeftIcon /> {chapter ? "Back to chapter" : "Back home"} <KeyHint>b</KeyHint>
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent>
          <h2 className="mb-3 text-sm font-medium">By section</h2>
          <table className="w-full text-sm">
            <tbody>
              {sectionKeys.map((id) => {
                const s = bySection.get(id)!;
                const sec = chapterForQuestion(rows.find((r) => r.q.section === id)!.q.id)?.sections.find((x) => x.id === id);
                return (
                  <tr key={id} className="border-t first:border-t-0">
                    <td className="py-1.5 pr-3 font-mono text-muted-foreground">§{id}</td>
                    <td className="w-full py-1.5 pr-3">{sec?.title}</td>
                    <td className="py-1.5 text-right font-mono whitespace-nowrap tabular-nums">
                      {s.correct} / {s.total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {missed.length ? (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Missed</h2>
          <ul className="space-y-2">
            {missed.map((r) => (
              <MissedItem key={r.q.id} row={r} finalCard={last.get(r.q.id)!.after} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing missed. Nice.</p>
      )}

      <SessionSetup entry={setup} onOpenChange={(o) => !o && setSetup(null)} />
    </div>
  );
}

function MissedItem({ row, finalCard }: { row: ResultRow; finalCard: EngineCard }) {
  const ch = chapterForQuestion(row.q.id);
  return (
    <li className="rounded-lg border">
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-start gap-3 p-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="font-mono text-xs text-muted-foreground">§{row.q.section}</span>
          <span className="flex-1">
            <Md text={row.q.prompt} />
          </span>
          <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 border-t p-3 text-sm">
          <p>
            <span className="text-muted-foreground">{row.answer === row.rating ? "Your rating: " : "Your answer: "}</span>
            <span className="text-destructive">
              <MdLines text={row.answer === row.rating ? "Again" : row.answer} />
            </span>
          </p>
          <div>
            <span className="text-muted-foreground">Right answer: </span>
            <span className="text-success">
              <MdLines text={answerText(row.q)} />
            </span>
          </div>
          <p className="text-muted-foreground">
            <Md text={row.q.explanation} />
          </p>
          <p className="text-xs text-muted-foreground">
            Next review: {finalCard.phase === "review" ? `in ${formatDue(finalCard, Date.now())}` : "later in a study session (still learning)"}
          </p>
          {ch ? <NoteLink target={{ chapter: ch.number, section: row.q.section, anchor: row.q.noteAnchor }} /> : null}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
