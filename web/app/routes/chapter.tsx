import { APP } from "~/config";
import { useEffect, useRef, useState } from "react";
import { data, Link, useNavigate, useSearchParams } from "react-router";
import { BookOpenIcon, ExternalLinkIcon, LayersIcon, ListChecksIcon, RotateCcwIcon } from "lucide-react";
import type { Route } from "./+types/chapter";
import { ensureCourse } from "~/content/load";
import { ExerciseList } from "~/components/exercise-list";
import { KeyHint } from "~/components/kbd";
import { MasteryBar } from "~/components/mastery-bar";
import { NotesPageLink } from "~/components/note-link";
import { SessionSetup, type SetupEntry } from "~/components/session-setup";
import { StatusChip } from "~/components/status-chip";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { SUBJECT, getChapter, hasNotes } from "~/content";
import { useHotkeys, useListNav } from "~/hooks/use-hotkeys";
import { chapterStatus, mastery, sectionMastery } from "~/lib/mastery";
import { notesHref } from "~/lib/notes";
import type { RouteHandle } from "~/lib/shortcuts";
import { setLastChapter, useProgress } from "~/state/progress-store";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await ensureCourse(params.course); // loaders run in parallel with the course layout's
  const chapter = getChapter(Number(params.number));
  if (!chapter) throw data("Chapter not found", { status: 404 });
  return { chapter };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Ch ${loaderData.chapter.number}: ${loaderData.chapter.title} · ${APP.name}` : "Not found" }];
}

export const handle: RouteHandle = {
  screen: "Chapter",
  shortcuts: [
    { keys: ["q"], label: "Quiz (selected sections, or whole chapter)" },
    { keys: ["f"], label: "Flashcards" },
    { keys: ["m"], label: "Review mistakes" },
    { keys: ["j", "k"], label: "Move between sections" },
    { keys: ["Space"], label: "Select / unselect section" },
    { keys: ["e"], label: "Switch to Exercises tab" },
    { keys: ["n"], label: "Open the study notes" },
  ],
};

export default function ChapterPage({ loaderData }: Route.ComponentProps) {
  const { chapter } = loaderData;
  const progress = useProgress();
  const navigate = useNavigate();
  const notes = hasNotes(chapter.number);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [setup, setSetup] = useState<SetupEntry | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hasExercises = chapter.exercises.length > 0;
  const tab = hasExercises && params.get("tab") === "exercises" ? "exercises" : "sections";

  useEffect(() => setLastChapter(chapter.number), [chapter.number]);
  useEffect(() => setSelected([]), [chapter.number]);
  useListNav(listRef, tab === "sections");

  const m = mastery(chapter.questions, progress.cards);
  const mistakes = chapter.questions.filter((q) => !q.retired && progress.cards[q.id]?.lastRating === "again").length;

  const open = (mode: SetupEntry["mode"]) =>
    setSetup({
      mode,
      scope: selected.length ? "sections" : "chapter",
      chapter: chapter.number,
      sections: selected,
    });
  const reviewMistakes = () => mistakes && setSetup({ mode: "quiz", scope: "mistakes", chapter: chapter.number, sections: selected });
  const setTab = (t: string) => setParams(t === "exercises" ? { tab: t } : {}, { replace: true });

  useHotkeys({
    q: () => open("quiz"),
    f: () => open("flashcards"),
    m: reviewMistakes,
    e: () => hasExercises && setTab(tab === "exercises" ? "sections" : "exercises"),
    n: () => notes && navigate(notesHref(chapter.number)),
  });

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="font-mono text-xs text-muted-foreground">
          {SUBJECT.short} · Chapter {chapter.number}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{chapter.title}</h1>
          <StatusChip status={chapterStatus(chapter, progress.cards, progress.exercises)} />
        </div>
        <MasteryBar m={m} label="Chapter mastery" className="max-w-sm" />
        {notes ? (
          <NotesPageLink target={{ chapter: chapter.number }}>
            <BookOpenIcon className="size-4" aria-hidden /> Study notes <KeyHint>n</KeyHint>
          </NotesPageLink>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => open("quiz")}>
          <ListChecksIcon /> Quiz{selected.length ? ` ${selected.length === 1 ? `§${selected[0]}` : `${selected.length} sections`}` : ""}
          <KeyHint className="border-primary-foreground/30 bg-transparent text-primary-foreground/80">q</KeyHint>
        </Button>
        <Button variant="outline" onClick={() => open("flashcards")}>
          <LayersIcon /> Flashcards <KeyHint>f</KeyHint>
        </Button>
        <Button variant="outline" onClick={reviewMistakes} disabled={!mistakes}>
          <RotateCcwIcon /> Review mistakes{mistakes ? ` (${mistakes})` : ""} <KeyHint>m</KeyHint>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        {hasExercises ? (
          <TabsList>
            <TabsTrigger value="sections">
              <BookOpenIcon /> Sections
            </TabsTrigger>
            <TabsTrigger value="exercises">Exercises ({chapter.exercises.length})</TabsTrigger>
          </TabsList>
        ) : null}

        <TabsContent value="sections" className="mt-2">
          <p className="mb-2 text-sm text-muted-foreground">
            {selected.length
              ? `${selected.length} selected. Quiz and flashcards will use only these sections.`
              : "Select sections to limit a session to them."}
            {selected.length ? (
              <Button variant="link" size="xs" onClick={() => setSelected([])}>
                Clear
              </Button>
            ) : null}
          </p>
          <ul ref={listRef} className="divide-y rounded-lg border">
            {chapter.sections.map((s) => {
              const count = chapter.questions.filter((q) => q.section === s.id && !q.retired).length;
              const sm = sectionMastery(chapter, s.id, progress.cards);
              const checked = selected.includes(s.id);
              const inputId = `sec-${s.id}`;
              return (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3">
                  <Checkbox
                    id={inputId}
                    data-nav
                    className="mt-0.5"
                    checked={checked}
                    disabled={count === 0}
                    onCheckedChange={(c) => setSelected((prev) => (c ? [...prev, s.id] : prev.filter((x) => x !== s.id)))}
                  />
                  <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[1fr_12rem] sm:items-center sm:gap-4">
                    <label htmlFor={inputId} className="min-w-0 cursor-pointer text-sm">
                      <span className="mr-2 font-mono text-muted-foreground">{s.id}</span>
                      {s.title}
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="w-8 shrink-0 text-xs text-muted-foreground tabular-nums">{count}q</span>
                      {count ? <MasteryBar m={sm} className="flex-1" label={`Section ${s.id} mastery`} /> : <span className="flex-1" />}
                    </div>
                  </div>
                  {notes ? (
                    <Link
                      to={notesHref(chapter.number, { section: s.id })}
                      className="mt-0.5 rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <ExternalLinkIcon className="size-3.5" aria-hidden />
                      <span className="sr-only">Section {s.id} in the study notes</span>
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </TabsContent>

        {hasExercises ? (
          <TabsContent value="exercises" className="mt-2">
            <ExerciseList exercises={chapter.exercises} />
          </TabsContent>
        ) : null}
      </Tabs>

      <SessionSetup entry={setup} onOpenChange={(o) => !o && setSetup(null)} />
    </div>
  );
}
