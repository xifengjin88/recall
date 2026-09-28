import { useEffect, useRef } from "react";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, XIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { Response } from "~/lib/grade";
import type { Presentation } from "~/lib/session";
import type { Question } from "~/lib/types";
import { cn } from "~/lib/utils";
import { Md } from "./md";

/** In-progress answer. Choice-like types (incl. true/false) share one shape. */
export type Draft =
  | { kind: "choice"; multi: boolean; values: string[] }
  | { kind: "text"; value: string }
  | { kind: "order"; items: string[] }
  | { kind: "match"; pairs: Record<string, string> };

export function initialDraft(q: Question, p: Presentation): Draft {
  if (p.options) return { kind: "choice", multi: q.type === "multi", values: [] };
  if (q.type === "order") return { kind: "order", items: p.items ?? q.items };
  if (q.type === "match") return { kind: "match", pairs: Object.fromEntries(q.pairs.map((x) => [x.term, ""])) };
  return { kind: "text", value: "" };
}

/** null while the draft isn't a complete answer yet. */
export function toResponse(q: Question, d: Draft): Response | null {
  switch (d.kind) {
    case "choice":
      if (!d.values.length) return null;
      if (q.type === "truefalse") return { kind: "bool", value: d.values[0] === "True" };
      return d.multi ? { kind: "multi", values: d.values } : { kind: "choice", value: d.values[0] };
    case "text":
      return d.value.trim() ? { kind: "text", value: d.value } : null;
    case "order":
      return { kind: "order", items: d.items };
    case "match":
      return Object.values(d.pairs).every(Boolean) ? { kind: "match", pairs: d.pairs } : null;
  }
}

function correctChoices(q: Question): string[] {
  switch (q.type) {
    case "single":
      return [q.answer];
    case "multi":
      return q.answers;
    case "truefalse":
      return [q.answer ? "True" : "False"];
    case "output":
      return q.options ? [q.answer] : [];
    default:
      return [];
  }
}

export interface AnswerInputProps {
  q: Question;
  p: Presentation;
  draft: Draft;
  onChange(d: Draft): void;
  /** Set once answered: inputs lock and show right/wrong marks. */
  answered: boolean;
  correct?: boolean;
}

export function AnswerInput(props: AnswerInputProps) {
  switch (props.draft.kind) {
    case "choice":
      return <ChoiceInput {...props} draft={props.draft} />;
    case "text":
      return <TextInput {...props} draft={props.draft} />;
    case "order":
      return <OrderInput {...props} draft={props.draft} />;
    case "match":
      return <MatchInput {...props} draft={props.draft} />;
  }
}

/** Toggle option N (1-based) — used by the number-key shortcuts. */
export function pickOption(d: Draft, p: Presentation, n: number): Draft {
  if (d.kind !== "choice" || !p.options || n < 1 || n > p.options.length) return d;
  const opt = p.options[n - 1];
  if (!d.multi) return { ...d, values: [opt] };
  return { ...d, values: d.values.includes(opt) ? d.values.filter((v) => v !== opt) : [...d.values, opt] };
}

function Mark({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium", ok ? "text-success" : "text-destructive")}>
      {ok ? <CheckIcon className="size-4" aria-hidden /> : <XIcon className="size-4" aria-hidden />}
      {label}
    </span>
  );
}

function ChoiceInput({ q, p, draft, onChange, answered }: AnswerInputProps & { draft: Extract<Draft, { kind: "choice" }> }) {
  const correct = correctChoices(q);
  return (
    <div role="group" aria-label={draft.multi ? "Select all that apply" : "Choose one"} className="grid gap-2">
      {draft.multi && !answered ? <p className="text-xs text-muted-foreground">Select all that apply.</p> : null}
      {p.options!.map((opt, i) => {
        const chosen = draft.values.includes(opt);
        const isRight = correct.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            data-nav
            data-enter-submits
            aria-pressed={chosen}
            disabled={answered}
            onClick={() => onChange(pickOption(draft, p, i + 1))}
            onFocus={() => {
              // Moving through single-choice options with j/k selects, like a radio group.
              if (!draft.multi && !answered && !chosen) onChange(pickOption(draft, p, i + 1));
            }}
            className={cn(
              "flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors outline-none",
              "hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
              chosen && !answered && "border-primary bg-muted",
              answered && isRight && "border-success bg-success/10",
              answered && chosen && !isRight && "border-destructive bg-destructive/10",
              answered && !chosen && !isRight && "opacity-60",
            )}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded border font-mono text-xs",
                draft.multi ? "rounded" : "rounded-full",
                chosen && "border-primary bg-primary text-primary-foreground",
              )}
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <Md text={opt} />
            </span>
            {answered && isRight ? <Mark ok label={chosen ? "Your answer · correct" : "Correct answer"} /> : null}
            {answered && chosen && !isRight ? <Mark ok={false} label="Your answer" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function TextInput({ q, draft, onChange, answered, correct }: AnswerInputProps & { draft: Extract<Draft, { kind: "text" }> }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const accept = q.type === "typed" ? q.accept : q.type === "output" && q.accept ? q.accept : [];
  return (
    <div className="space-y-2">
      <label htmlFor="typed-answer" className="text-xs text-muted-foreground">
        Type your answer, then press Enter
      </label>
      <div className="flex items-center gap-2">
        <Input
          id="typed-answer"
          ref={ref}
          value={draft.value}
          onChange={(e) => onChange({ kind: "text", value: e.target.value })}
          readOnly={answered}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={answered && !correct ? true : undefined}
          className={cn("h-11 font-mono", answered && correct && "border-success")}
        />
        {answered ? <Mark ok={!!correct} label={correct ? "Correct" : "Incorrect"} /> : null}
      </div>
      {answered && !correct ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Accepted: </span>
          {accept.map((a, i) => (
            <span key={a}>
              {i ? <span className="text-muted-foreground"> · </span> : null}
              <code>{a}</code>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function OrderInput({ q, draft, onChange, answered }: AnswerInputProps & { draft: Extract<Draft, { kind: "order" }> }) {
  if (q.type !== "order") return null;
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= draft.items.length) return;
    const items = [...draft.items];
    [items[i], items[j]] = [items[j], items[i]];
    onChange({ kind: "order", items });
    // Keep focus on the moved item.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-order-index="${j}"]`)?.focus());
  };
  return (
    <div className="space-y-2">
      {!answered ? (
        <p className="text-xs text-muted-foreground">
          Arrange into the right order. Use the arrows, or focus an item and press <kbd>Shift</kbd>+<kbd>J</kbd>/<kbd>K</kbd>.
        </p>
      ) : null}
      <ol className="grid gap-2">
        {draft.items.map((it, i) => {
          const ok = q.items[i] === it;
          return (
            <li
              key={it}
              className={cn(
                "flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3 text-sm",
                answered && (ok ? "border-success bg-success/10" : "border-destructive bg-destructive/10"),
              )}
            >
              <span className="w-5 font-mono text-xs text-muted-foreground">{i + 1}.</span>
              <button
                type="button"
                data-nav
                data-enter-submits
                data-order-index={i}
                disabled={answered}
                className="min-h-8 min-w-0 flex-1 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onKeyDown={(e) => {
                  if (!e.shiftKey) return;
                  const k = e.key.toLowerCase();
                  if (k === "j" || k === "arrowdown") (e.preventDefault(), move(i, 1));
                  if (k === "k" || k === "arrowup") (e.preventDefault(), move(i, -1));
                }}
              >
                <Md text={it} />
              </button>
              {answered ? (
                <Mark ok={ok} label={ok ? "Right place" : `Should be ${q.items.indexOf(it) + 1}`} />
              ) : (
                <span className="flex shrink-0">
                  <Button variant="ghost" size="icon-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move "${it}" up`} tabIndex={-1}>
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => move(i, 1)}
                    disabled={i === draft.items.length - 1}
                    aria-label={`Move "${it}" down`}
                    tabIndex={-1}
                  >
                    <ArrowDownIcon />
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MatchInput({ q, p, draft, onChange, answered }: AnswerInputProps & { draft: Extract<Draft, { kind: "match" }> }) {
  const firstRef = useRef<HTMLSelectElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  if (q.type !== "match") return null;
  return (
    <div className="space-y-2">
      {!answered ? <p className="text-xs text-muted-foreground">Pick the matching description for each term. Tab moves between them.</p> : null}
      <div className="grid gap-2">
        {q.pairs.map((pair, i) => {
          const chosen = draft.pairs[pair.term];
          const ok = chosen === pair.definition;
          const id = `match-${i}`;
          return (
            <div
              key={pair.term}
              className={cn(
                "grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_1fr] sm:items-center",
                answered && (ok ? "border-success bg-success/10" : "border-destructive bg-destructive/10"),
              )}
            >
              <label htmlFor={id} className="text-sm font-medium">
                <Md text={pair.term} />
              </label>
              <div className="min-w-0 space-y-1">
                <select
                  id={id}
                  ref={i === 0 ? firstRef : undefined}
                  value={chosen}
                  disabled={answered}
                  onChange={(e) => onChange({ kind: "match", pairs: { ...draft.pairs, [pair.term]: e.target.value } })}
                  className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-100 dark:bg-input/30"
                >
                  <option value="">Choose…</option>
                  {p.definitions!.map((d) => (
                    <option key={d} value={d}>
                      {d.replace(/`/g, "")}
                    </option>
                  ))}
                </select>
                {answered ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    <Mark ok={ok} label={ok ? "Correct" : "Incorrect"} />
                    {!ok ? (
                      <span>
                        Correct: <Md text={pair.definition} />
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
