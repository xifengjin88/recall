import type { Minutes } from "./types";

const UNIT: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 24 * 60 };

/** Parse Anki-style steps, "1m 10m 1d" (bare numbers are minutes). Null when invalid. */
export function parseSteps(input: string): Minutes[] | null {
  const parts = input.trim().split(/[\s,]+/).filter(Boolean);
  const out: Minutes[] = [];
  for (const p of parts) {
    const m = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(p);
    if (!m) return null;
    const mins = Number(m[1]) * UNIT[(m[2] || "m").toLowerCase()];
    if (!(mins > 0)) return null;
    out.push(mins);
  }
  return out;
}

export function formatSteps(steps: Minutes[]): string {
  return steps
    .map((m) => (m % (24 * 60) === 0 ? `${m / (24 * 60)}d` : m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${m}m`))
    .join(" ");
}
