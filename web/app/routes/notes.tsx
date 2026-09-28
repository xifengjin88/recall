import { APP } from "~/config";
import { data, Link } from "react-router";
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";
import type { Route } from "./+types/notes";
import { ensureCourse } from "~/content/load";
import { NoteMarkdown } from "~/components/note-markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { SUBJECT, getChapter, getNotes } from "~/content";
import { useHotkeys } from "~/hooks/use-hotkeys";
import { noteToc, stripTitle } from "~/lib/notes";
import type { RouteHandle } from "~/lib/shortcuts";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await ensureCourse(params.course); // loaders run in parallel with the course layout's
  const n = Number(params.number);
  const chapter = getChapter(n);
  const md = getNotes(n);
  if (!chapter || !md) throw data("Notes not found", { status: 404 });
  return { chapter, md };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData ? `Notes · Ch ${loaderData.chapter.number}: ${loaderData.chapter.title} · ${APP.name}` : "Not found" }];
}

export const handle: RouteHandle = {
  screen: "Study notes",
  shortcuts: [
    { keys: ["b"], label: "Back to the chapter" },
    { keys: ["t"], label: "Back to top" },
  ],
};

export default function NotesPage({ loaderData }: Route.ComponentProps) {
  const { chapter, md } = loaderData;
  const toc = noteToc(md);
  const back = `/chapters/${chapter.number}`;

  useHotkeys({
    b: () => document.querySelector<HTMLAnchorElement>("[data-back-to-chapter]")?.click(),
    t: () => window.scrollTo({ top: 0, behavior: "smooth" }),
  });

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <Link to={back} data-back-to-chapter className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" /> Chapter {chapter.number}
        </Link>
        <p className="font-mono text-xs text-muted-foreground">
          {SUBJECT.short} · Chapter {chapter.number} · Study notes
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{chapter.title}</h1>
      </header>

      <Collapsible className="rounded-lg border">
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          On this page
          <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="columns-1 gap-6 border-t px-4 py-3 text-sm sm:columns-2">
            {toc.map((t) => (
              <li key={t.id} className="break-inside-avoid py-0.5">
                <a href={`#${t.id}`} className="text-muted-foreground hover:text-foreground">
                  {t.text}
                </a>
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>

      <NoteMarkdown markdown={stripTitle(md)} chapter={chapter.number} />
    </article>
  );
}
