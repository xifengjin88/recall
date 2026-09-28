// Study notes are Obsidian-flavoured markdown kept in app/content/notes/chNN.md.
// These helpers are pure so they can be unit tested; rendering is in components/note-markdown.tsx.

/**
 * Stable id for a heading. Numbered section headings ("2.7 Processes") get "s2.7" so
 * questions can link by section id whatever the heading wording; others are slugged.
 */
export function headingId(text: string): string {
  const m = /^(\d+\.\d+)\s/.exec(text.trim());
  if (m) return `s${m[1]}`;
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const sectionHeadingId = (sectionId: string) => `s${sectionId}`;

/** In-app URL for a chapter's notes, optionally at a section or custom heading. */
export function notesHref(chapter: number, target?: { section?: string; anchor?: string }): string {
  const hash = target?.anchor ? headingId(target.anchor) : target?.section ? sectionHeadingId(target.section) : "";
  return `/chapters/${chapter}/notes${hash ? `#${hash}` : ""}`;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Lines of a markdown doc, with fenced code blocks marked so '#' comments aren't read as headings. */
function scan(md: string) {
  const lines = md.split("\n");
  let fence: string | null = null;
  return lines.map((line) => {
    const f = /^\s*(>\s*)*(```|~~~)/.exec(line);
    if (f) {
      if (fence === null) fence = f[2];
      else if (f[2] === fence) fence = null;
      return { line, heading: null };
    }
    const h = fence === null ? HEADING.exec(line) : null;
    return { line, heading: h ? { level: h[1].length, text: h[2] } : null };
  });
}

/**
 * The markdown for one section: the heading that matches the section id (or the custom
 * anchor), through to the next heading of the same or higher level.
 */
export function extractNoteSection(md: string, target: { section?: string; anchor?: string }): string | null {
  const rows = scan(md);
  const want = target.anchor ? headingId(target.anchor) : target.section ? sectionHeadingId(target.section) : null;
  if (!want) return null;
  const start = rows.findIndex((r) => r.heading && r.heading.level > 1 && headingId(r.heading.text) === want);
  if (start === -1) return null;
  const level = rows[start].heading!.level;
  let end = rows.findIndex((r, i) => i > start && r.heading && r.heading.level <= level);
  if (end === -1) end = rows.length;
  return rows
    .slice(start, end)
    .map((r) => r.line)
    .join("\n")
    .replace(/\n-{3,}\s*$/, "")
    .trim();
}

export interface TocItem {
  id: string;
  text: string;
}

/** The level-2 headings, for the notes page's "on this page" list. */
export function noteToc(md: string): TocItem[] {
  return scan(md)
    .filter((r) => r.heading?.level === 2)
    .map((r) => ({ id: headingId(r.heading!.text), text: r.heading!.text }));
}

/** Drop a leading "# Title" line: the notes page renders its own header. */
export const stripTitle = (md: string) => md.replace(/^\s*#\s+[^\n]*\n/, "");

/**
 * Turn Obsidian wikilinks into markdown links:
 *   [[#Heading|alias]]            -> [alias](#heading-id)
 *   [[TLPI 06 - Processes]]       -> [TLPI 06 - Processes](/chapters/6/notes), if those notes exist
 *   [[TLPI 06 - Processes#Heading]] -> …/notes#heading-id
 * Links to notes that don't exist yet become plain text.
 */
export function resolveWikilinks(md: string, hasNotes: (chapter: number) => boolean): string {
  return md.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_all, target: string, alias?: string) => {
    const [page, heading] = target.split("#") as [string, string | undefined];
    const label = alias ?? (page ? target.replace("#", " › ") : heading ?? target);
    if (!page) return `[${label}](#${headingId(heading ?? "")})`;
    const m = /^TLPI\s+(\d+)\b/i.exec(page.trim());
    const n = m ? Number(m[1]) : null;
    if (n === null || !hasNotes(n)) return label;
    return `[${label}](${notesHref(n)}${heading ? `#${headingId(heading)}` : ""})`;
  });
}
