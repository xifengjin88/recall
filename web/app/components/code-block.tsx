import type { CodeBlock as Code } from "~/lib/types";

export function CodeBlock({ code }: { code: Code }) {
  return (
    <figure className="relative min-w-0 overflow-hidden rounded-lg border bg-muted/50">
      <figcaption className="absolute top-1.5 right-2 font-mono text-[0.7rem] text-muted-foreground uppercase select-none">
        {code.lang}
      </figcaption>
      <pre className="overflow-x-auto p-3 pr-12 font-mono text-sm leading-relaxed" tabIndex={0}>
        <code>{code.source}</code>
      </pre>
    </figure>
  );
}
