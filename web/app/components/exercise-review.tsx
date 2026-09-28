import { useEffect, useState } from "react";
import { CalendarClockIcon, PauseIcon, PlayIcon, RepeatIcon, ZapIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { formatDay, studyDay } from "~/lib/dates";
import type { Previews } from "~/api/types";
import { formatDue, isDue, RATINGS, type Card, type Rating } from "~/lib/engine";
import { RATING_MEANING, suggestRating } from "~/lib/exercise-rating";
import type { ExerciseState } from "~/lib/progress";
import type { Exercise } from "~/lib/types";
import { cn } from "~/lib/utils";
import {
  completeSession,
  previewCard,
  recordReview,
  startExerciseAttempt,
  startSession,
  updateExercise,
  useProgress,
} from "~/state/progress-store";

const LABEL: Record<Rating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Shown when a finished exercise has come due again. */
export function RedoBanner({ ex, state, card }: { ex: Exercise; state: ExerciseState; card: Card | undefined }) {
  const now = Date.now();
  const midRedo = state.attempt !== "first" && state.status === "in-progress";
  if (!card || !isDue(card, now) || state.status === "skipped" || midRedo) return null;
  return (
    <Alert>
      <RepeatIcon />
      <AlertTitle>Due for a redo</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Last rated <strong>{card.lastRating ? LABEL[card.lastRating] : "—"}</strong>
          {card.lastReview ? ` on ${formatDay(studyDay(card.lastReview))}` : ""}. Redo it from scratch, or do a quick review if a full redo
          is overkill today. Your notes stay; ticks and hints reset.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => startExerciseAttempt(ex.id, "redo")}>
            <PlayIcon /> Full redo
          </Button>
          <Button size="sm" variant="outline" onClick={() => startExerciseAttempt(ex.id, "quick")}>
            <ZapIcon /> Quick review
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Finishing an attempt: rate it, and the engine decides when it comes back. Also the
 * skip / un-skip control (skipping suspends the card so it's never scheduled).
 */
export function ExerciseReview({ ex, state, allTicked }: { ex: Exercise; state: ExerciseState; allTicked: boolean }) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [rated, setRated] = useState<{ rating: Rating; after: Card } | null>(null);
  const [reviewId, setReviewId] = useState(newId);
  const progress = useProgress();
  const card = progress.cards[ex.id];
  const now = Date.now();
  const [previews, setPreviews] = useState<Previews | null>(null);
  const [saving, setSaving] = useState(false);
  // The server computes what each rating would schedule; refetch whenever the card changes.
  useEffect(() => {
    let live = true;
    previewCard(ex.id)
      .then((p) => live && setPreviews(p))
      .catch(() => {}); // labels are optional
    return () => {
      live = false;
    };
  }, [ex.id, card]);

  if (state.status === "skipped") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">Skipped. It won't be scheduled for redo.</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            updateExercise(ex.id, { status: card ? "done" : "in-progress" });
          }}
        >
          <PlayIcon /> Un-skip
        </Button>
      </div>
    );
  }

  const quick = state.attempt === "quick";
  const finished = state.status === "done";
  const canRate = !finished && (quick || allTicked);
  const duration = state.attemptStartedAt ? now - state.attemptStartedAt : null;
  const suggestion = quick ? { rating: "good" as Rating, why: "quick review" } : suggestRating({ hintsRevealed: state.hintsRevealed, durationMs: duration, estimate: ex.estimate });
  const chosen = rating ?? suggestion.rating;

  async function submit() {
    if (saving) return;
    const sessionId = newId();
    startSession(sessionId, "exercise");
    setSaving(true);
    const saved = await recordReview({
      reviewId,
      cardId: ex.id,
      kind: "exercise",
      source: "exercise",
      sessionId,
      rating: chosen,
      correct: chosen !== "again",
      answer: `${state.attempt} attempt`,
      hinted: state.hintsRevealed > 0,
      ...(duration !== null ? { durationMs: duration } : {}),
      meta: { attempt: state.attempt, hintsRevealed: state.hintsRevealed, testsPassed: state.testsPassed.length, testsTotal: ex.tests.length },
    }).catch(() => null);
    setSaving(false);
    if (!saved) return; // the notice says it didn't save; the button stays to retry
    const { after } = saved;
    completeSession(sessionId);
    setRated({ rating: chosen, after });
    setReviewId(newId());
    setRating(null);
  }

  return (
    <div className="space-y-4">
      {finished ? (
        <p className="flex items-center gap-2 text-sm">
          <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden />
          {rated ? `Rated ${LABEL[rated.rating]}. ` : ""}
          {card && !isDue(card, now) ? `Next redo in ${formatDue(card, now)} (${formatDay(studyDay(card.due))}).` : card ? "Due for a redo now." : ""}
        </p>
      ) : quick ? (
        <p className="text-sm">
          <strong>Quick review:</strong> without opening your old solution, sketch the approach in <em>My notes</em>: the syscalls you'd use, the edge
          cases, what went wrong last time. Then rate how well you remembered it.
        </p>
      ) : !allTicked ? (
        <p className="text-sm text-muted-foreground">Tick every test to finish and rate this attempt.</p>
      ) : null}

      {canRate ? (
        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">How did it go?</legend>
          <p className="text-xs text-muted-foreground">
            Suggested: <strong>{LABEL[suggestion.rating]}</strong>, because {suggestion.why}. You decide.
          </p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Rating">
            {RATINGS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={chosen === r}
                onClick={() => setRating(r)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  chosen === r ? "border-primary bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="flex w-full items-center justify-between font-medium">
                  {LABEL[r]}
                  <span className="font-mono text-xs text-muted-foreground">{previews ? `next in ${formatDue(previews[r], now)}` : ""}</span>
                </span>
                <span className="text-xs text-muted-foreground">{RATING_MEANING[r]}</span>
              </button>
            ))}
          </div>
          <Button onClick={submit} disabled={saving}>Rate {LABEL[chosen]} and finish</Button>
        </fieldset>
      ) : null}

      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            updateExercise(ex.id, { status: "skipped" });
          }}
        >
          <PauseIcon /> Skip this exercise
        </Button>
      </div>
    </div>
  );
}
