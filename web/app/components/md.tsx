import { Fragment, type ReactNode } from "react";

// Just enough inline markdown for prompts and options: `code`, **bold**, *emphasis*
// and _emphasis_ (only at word boundaries, so snake_case stays intact).
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|(?<![\w])_[^_\s][^_]*_(?![\w]))/g;

export function Md({ text }: { text: string }) {
  const parts = text.split(TOKEN).filter(Boolean);
  return (
    <>
      {parts.map((p, i): ReactNode => {
        if (p.startsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if ((p.startsWith("*") || p.startsWith("_")) && p.length > 2 && p.endsWith(p[0])) return <em key={i}>{p.slice(1, -1)}</em>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/** Multi-line text (e.g. an order answer) with inline markdown per line. */
export function MdLines({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <span key={i} className="block">
          <Md text={line} />
        </span>
      ))}
    </>
  );
}
