import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router";
import { hasNotes } from "~/content";
import { remarkCallouts } from "~/lib/callouts";
import { headingId, resolveWikilinks } from "~/lib/notes";
import type { CodeBlock as Code } from "~/lib/types";
import { cn } from "~/lib/utils";
import { useProgress } from "~/state/progress-store";
import { CodeBlock } from "./code-block";
import { coursePath } from "~/lib/paths";

function textOf(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textOf).join("");
  if (children && typeof children === "object" && "props" in children) {
    return textOf((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

const LANGS = new Set(["c", "bash", "text"]);

/**
 * Renders a chapter's study notes. `embedded` is for the side panel: links that would
 * leave the current screen (e.g. mid-session) open the full notes page in a new tab.
 */
export function NoteMarkdown({ markdown, chapter, embedded = false }: { markdown: string; chapter: number; embedded?: boolean }) {
  const source = useMemo(() => resolveWikilinks(markdown, hasNotes), [markdown]);

  const components = useMemo<Components>(() => {
    const heading =
      (Tag: "h2" | "h3" | "h4") =>
      ({ children }: { children?: ReactNode }) => (
        <Tag id={embedded ? undefined : headingId(textOf(children))} className="scroll-mt-20">
          {children}
        </Tag>
      );
    return {
      h1: () => null,
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      a: ({ href = "", children }) => {
        const inPage = href.startsWith("#");
        const internal = inPage || href.startsWith("/");
        if (!internal) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
        const to = inPage && embedded ? coursePath(`/chapters/${chapter}/notes${href}`) : inPage ? href : coursePath(href);
        if (embedded) return <a href={to} target="_blank" rel="noreferrer">{children}</a>;
        return inPage ? <a href={to}>{children}</a> : <Link to={to}>{children}</Link>;
      },
      table: ({ children }) => (
        <div className="not-prose my-4 overflow-x-auto rounded-lg border">
          <table className="w-full text-sm [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium">
            {children}
          </table>
        </div>
      ),
      pre: ({ children }) => {
        const code = (children as { props?: { className?: string; children?: ReactNode } } | undefined)?.props;
        const lang = /language-(\S+)/.exec(code?.className ?? "")?.[1] ?? "text";
        const text = textOf(code?.children).replace(/\n$/, "");
        if (lang === "mermaid") return <Mermaid code={text} />;
        return (
          <div className="not-prose my-4">
            <CodeBlock code={{ lang: (LANGS.has(lang) ? lang : "text") as Code["lang"], source: text }} />
          </div>
        );
      },
    };
  }, [chapter, embedded]);

  return (
    <div
      className={cn(
        "prose prose-neutral max-w-none dark:prose-invert",
        "prose-headings:scroll-mt-20 prose-h2:mt-10 prose-h2:border-t prose-h2:pt-6",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-mono prose-code:text-[0.9em] prose-code:font-normal prose-code:before:content-none prose-code:after:content-none",
        "prose-a:text-primary prose-a:underline-offset-4 prose-hr:hidden",
      )}
    >
      <Markdown remarkPlugins={[remarkGfm, remarkCallouts]} components={components}>
        {source}
      </Markdown>
    </div>
  );
}

let mermaidSeq = 0;

/** Mermaid is large, so it's loaded only when a note actually contains a diagram. */
function Mermaid({ code }: { code: string }) {
  const { settings } = useProgress();
  const reactId = useId();
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const dark = document.documentElement.classList.contains("dark");
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral" });
        const id = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, "")}-${++mermaidSeq}`;
        const out = await mermaid.render(id, code);
        if (alive) setSvg(out.svg);
      })
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [code, reactId, settings.theme]);

  if (!svg) {
    return (
      <div className="not-prose my-4">
        <CodeBlock code={{ lang: "text", source: code }} />
      </div>
    );
  }
  return (
    <div
      className="not-prose my-4 flex justify-center overflow-x-auto rounded-lg border p-4 [&_svg]:max-w-full"
      role="img"
      aria-label="Diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
