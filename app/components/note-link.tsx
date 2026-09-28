import { useState } from "react";
import { Link } from "react-router";
import { BookOpenIcon, ExternalLinkIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "~/components/ui/sheet";
import { getChapter, getNotes } from "~/content";
import { extractNoteSection, notesHref } from "~/lib/notes";
import { cn } from "~/lib/utils";
import { KeyHint } from "./kbd";
import { NoteMarkdown } from "./note-markdown";

export interface NoteTarget {
  chapter: number;
  section?: string;
  /** A specific heading (question/exercise `noteAnchor`); wins over `section`. */
  anchor?: string;
}

/** Side panel with one section of a chapter's study notes, so you don't lose your place. */
export function NoteSheet({ target, open, onOpenChange }: { target: NoteTarget; open: boolean; onOpenChange(o: boolean): void }) {
  const md = getNotes(target.chapter);
  const part = md ? extractNoteSection(md, target) : null;
  const chapter = getChapter(target.chapter);
  const section = chapter?.sections.find((s) => s.id === target.section);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>Study notes</SheetTitle>
          <SheetDescription>
            Chapter {target.chapter}
            {section ? ` · §${section.id} ${section.title}` : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {part ? (
            <NoteMarkdown markdown={part} chapter={target.chapter} embedded />
          ) : (
            <p className="text-sm text-muted-foreground">
              {md ? "This section isn't in the notes yet." : "There are no notes for this chapter yet."}
            </p>
          )}
          {md ? (
            <a
              href={notesHref(target.chapter, target)}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Open full chapter notes <ExternalLinkIcon className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "See in notes": opens the section in a side panel. Pass `open`/`onOpenChange` when a
 * keyboard shortcut also needs to open it.
 */
export function NoteLink({
  target,
  children = "See in notes",
  hotkey,
  className,
  open: openProp,
  onOpenChange,
}: {
  target: NoteTarget;
  children?: React.ReactNode;
  hotkey?: string;
  className?: string;
  open?: boolean;
  onOpenChange?(o: boolean): void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <BookOpenIcon className="size-3.5" aria-hidden />
        {children}
        {hotkey ? <KeyHint>{hotkey}</KeyHint> : null}
      </button>
      <NoteSheet target={target} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Plain link to the notes page (for places where leaving the screen is fine). */
export function NotesPageLink({ target, children, className }: { target: NoteTarget; children: React.ReactNode; className?: string }) {
  return (
    <Link
      to={notesHref(target.chapter, target)}
      className={cn("inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline", className)}
    >
      {children}
    </Link>
  );
}
