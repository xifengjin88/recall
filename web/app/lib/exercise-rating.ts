import type { Rating } from "./cards";

/** "45 min", "1 h", "1.5 hours", "90m" → minutes. Null when it can't be read. */
export function parseEstimate(estimate: string | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\s*$/i.exec(estimate ?? "");
  if (!m) return null;
  return Number(m[1]) * (m[2].toLowerCase().startsWith("h") ? 60 : 1);
}

export const RATING_MEANING: Record<Rating, string> = {
  again: "Needed the solution, or couldn't finish",
  hard: "Finished, but struggled or leaned on hints",
  good: "Finished with normal effort",
  easy: "Could write it again quickly from memory",
};

/**
 * A starting point for the self-rating, from what the app saw. Only ever Good or Hard:
 * Again and Easy are judgements only the learner can make.
 */
export function suggestRating(a: { hintsRevealed: number; durationMs: number | null; estimate?: string }): { rating: Rating; why: string } {
  if (a.hintsRevealed > 0) return { rating: "hard", why: `you revealed ${a.hintsRevealed} hint${a.hintsRevealed === 1 ? "" : "s"}` };
  const est = parseEstimate(a.estimate);
  if (est && a.durationMs !== null && a.durationMs > 2 * est * 60_000) {
    return { rating: "hard", why: "it took more than twice the estimate" };
  }
  return { rating: "good", why: "no hints used" };
}
