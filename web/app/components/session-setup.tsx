import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { CHAPTERS, getChapter } from "~/content";
import { resolvePreset } from "~/lib/engine";
import type { SessionLength, SessionOrder } from "~/lib/progress";
import { newSeed, pickQuestions, SCOPE_LABELS, specToSearch, type Scope, type SessionSpec } from "~/lib/session";
import { QUESTION_TYPES, type QuestionType } from "~/lib/types";
import { updatePrefs, useProgress } from "~/state/progress-store";
import { KeyHint } from "./kbd";
import { coursePath } from "~/lib/paths";

/** Where the setup panel was opened from; decides the default scope. */
type SessionMode = SessionSpec["mode"];

export interface SetupEntry {
  mode: SessionMode;
  scope: Exclude<Scope, "ids">;
  chapter: number | null;
  sections?: string[];
}

export function SessionSetup({
  entry,
  onOpenChange,
}: {
  entry: SetupEntry | null;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        // Focus Start rather than the first toggle, so Enter starts immediately (spec §3.3).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
        }}
      >
        {entry ? <SetupForm key={JSON.stringify(entry)} entry={entry} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SetupForm({ entry }: { entry: SetupEntry }) {
  const navigate = useNavigate();
  const progress = useProgress();
  const [mode, setMode] = useState<SessionMode>(entry.mode);
  const [scope, setScope] = useState<Exclude<Scope, "ids">>(entry.scope);
  const [length, setLength] = useState<SessionLength>(progress.prefs.length);
  const [order, setOrder] = useState<SessionOrder>(progress.prefs.order);
  const [types, setTypes] = useState<QuestionType[]>(progress.prefs.types);
  const [difficulty, setDifficulty] = useState(progress.prefs.difficulty);

  const chapter = entry.chapter === null ? undefined : getChapter(entry.chapter);
  const sections = entry.sections ?? [];
  const scopes = (Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).filter((s) => {
    if (s === "chapter") return !!chapter;
    if (s === "sections") return !!chapter && sections.length > 0;
    return true;
  });

  const spec: SessionSpec = {
    mode,
    scope,
    // "All chapters" ignores the entry chapter; due/mistakes stay within it when opened from a chapter.
    chapter: scope === "all" ? null : (entry.chapter ?? null),
    sections: scope === "sections" ? sections : [],
    ids: [],
    length,
    order,
    types,
    difficulty,
    seed: 0,
  };
  const count = useMemo(
    () =>
      pickQuestions(CHAPTERS, { ...spec, length: "all" }, {
        cards: progress.cards,
        reviews: progress.reviews,
        now: Date.now(),
        preset: resolvePreset("question", progress.settings.scheduling),
      }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(spec), progress.cards, progress.reviews, progress.settings.scheduling],
  );
  const sessionSize = length === "all" ? count : Math.min(length, count);

  function start(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionSize) return;
    updatePrefs({ length, order, types, difficulty });
    navigate(coursePath(`/session${specToSearch({ ...spec, seed: newSeed() })}`));
  }

  const sectionLabel = sections.length === 1 ? `§${sections[0]}` : `${sections.length} sections`;

  return (
    <form onSubmit={start} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{mode === "quiz" ? "Quiz" : "Flashcards"}</DialogTitle>
        <DialogDescription>
          {chapter ? `Chapter ${chapter.number}: ${chapter.title}` : "All chapters"}. Press Enter to start.
        </DialogDescription>
      </DialogHeader>

      <Field label="Mode">
        <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v as SessionMode)}>
          <ToggleGroupItem value="quiz">Quiz</ToggleGroupItem>
          <ToggleGroupItem value="flashcards">Flashcards</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Scope">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={scope}
          onValueChange={(v) => v && setScope(v as typeof scope)}
        >
          {scopes.map((s) => (
            <ToggleGroupItem key={s} value={s}>
              {s === "sections" ? sectionLabel : SCOPE_LABELS[s]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Length">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(length)}
            onValueChange={(v) => v && setLength(v === "all" ? "all" : (Number(v) as 10 | 20))}
          >
            <ToggleGroupItem value="10">10</ToggleGroupItem>
            <ToggleGroupItem value="20">20</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field label="Order">
          <ToggleGroup type="single" variant="outline" size="sm" value={order} onValueChange={(v) => v && setOrder(v as SessionOrder)}>
            <ToggleGroupItem value="shuffled">Shuffled</ToggleGroupItem>
            <ToggleGroupItem value="book">Book order</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>

      <Field label="Types" hint={types.length ? undefined : "all"}>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={types}
          onValueChange={(v) => setTypes(v.length === QUESTION_TYPES.length ? [] : (v as QuestionType[]))}
        >
          {QUESTION_TYPES.map((t) => (
            <ToggleGroupItem key={t.type} value={t.type}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Field label="Difficulty">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(difficulty)}
          onValueChange={(v) => v && setDifficulty(Number(v) as 0 | 1 | 2 | 3)}
        >
          <ToggleGroupItem value="0">Any</ToggleGroupItem>
          <ToggleGroupItem value="1">1 · recall</ToggleGroupItem>
          <ToggleGroupItem value="2">2 · apply</ToggleGroupItem>
          <ToggleGroupItem value="3">3 · reason</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <DialogFooter className="items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {count === 0 ? "No questions match these options." : `${sessionSize} of ${count} matching questions`}
        </p>
        <Button type="submit" disabled={!sessionSize}>
          Start <KeyHint className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">Enter</KeyHint>
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
        {hint ? <span className="font-normal normal-case">({hint})</span> : null}
      </Label>
      {children}
    </div>
  );
}
