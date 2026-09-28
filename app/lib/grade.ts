import type { Question } from "./types";

/**
 * What the learner submitted. Choice answers are option *text* (not indexes), so
 * grading doesn't depend on the shuffled display order.
 */
export type Response =
  | { kind: "choice"; value: string }
  | { kind: "multi"; values: string[] }
  | { kind: "bool"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "order"; items: string[] }
  | { kind: "match"; pairs: Record<string, string> }; // term -> chosen definition

/** Trim and collapse internal whitespace (spec §5.3, typed). */
export function normalizeText(s: string, caseSensitive = false): string {
  const t = s.trim().replace(/\s+/g, " ");
  return caseSensitive ? t : t.toLowerCase();
}

function textMatches(input: string, accept: string[], caseSensitive = false): boolean {
  const got = normalizeText(input, caseSensitive);
  if (got === "") return false;
  return accept.some((a) => normalizeText(a, caseSensitive) === got);
}

export function grade(q: Question, r: Response): boolean {
  switch (q.type) {
    case "single":
      return r.kind === "choice" && r.value === q.answer;
    case "multi": {
      if (r.kind !== "multi") return false;
      const got = new Set(r.values);
      const want = new Set(q.answers);
      return got.size === want.size && [...want].every((a) => got.has(a));
    }
    case "truefalse":
      return r.kind === "bool" && r.value === q.answer;
    case "typed":
      return r.kind === "text" && textMatches(r.value, q.accept, q.caseSensitive);
    case "output":
      if (q.options) return r.kind === "choice" && r.value === q.answer;
      return r.kind === "text" && textMatches(r.value, q.accept, q.caseSensitive);
    case "order":
      return r.kind === "order" && r.items.length === q.items.length && r.items.every((it, i) => it === q.items[i]);
    case "match":
      return r.kind === "match" && q.pairs.every((p) => r.pairs[p.term] === p.definition);
  }
}

/** The correct answer as display text (flashcard backs, summaries). */
export function answerText(q: Question): string {
  switch (q.type) {
    case "single":
      return q.answer;
    case "multi":
      return q.answers.join(" · ");
    case "truefalse":
      return q.answer ? "True" : "False";
    case "typed":
      return q.accept[0];
    case "output":
      return q.options ? q.answer : q.accept[0];
    case "order":
      return q.items.map((it, i) => `${i + 1}. ${it}`).join("\n");
    case "match":
      return q.pairs.map((p) => `${p.term} → ${p.definition}`).join("\n");
  }
}

/** The learner's response as display text (summaries, attempt history). */
export function responseText(r: Response): string {
  switch (r.kind) {
    case "choice":
    case "text":
      return r.value;
    case "multi":
      return r.values.length ? r.values.join(" · ") : "(nothing selected)";
    case "bool":
      return r.value ? "True" : "False";
    case "order":
      return r.items.map((it, i) => `${i + 1}. ${it}`).join("\n");
    case "match":
      return Object.entries(r.pairs)
        .map(([t, d]) => `${t} → ${d || "?"}`)
        .join("\n");
  }
}
