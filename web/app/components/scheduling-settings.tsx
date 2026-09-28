import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { formatSteps, parseSteps, PRESETS, resolvePreset, type CardKind, type Preset } from "~/lib/engine";
import { cn } from "~/lib/utils";
import { updateScheduling, useProgress, useScheduling } from "~/state/progress-store";

type NumKey = { [K in keyof Preset]: Preset[K] extends number ? K : never }[keyof Preset];
type StepKey = "learnSteps" | "relearnSteps";

type Field =
  | { key: StepKey; label: string; help: string; kind: "steps" }
  | { key: NumKey; label: string; help: string; kind: "int"; min: number; max: number; unit: string }
  | { key: NumKey; label: string; help: string; kind: "percent"; min: number; max: number };

/** Anki's deck options, grouped the same way. Ranges follow Anki's own limits. */
const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Daily limits",
    fields: [
      { key: "newPerDay", label: "New cards/day", help: "How many unseen cards today's queue introduces.", kind: "int", min: 0, max: 9999, unit: "" },
      { key: "reviewsPerDay", label: "Maximum reviews/day", help: "Due reviews beyond this wait until tomorrow.", kind: "int", min: 0, max: 99999, unit: "" },
    ],
  },
  {
    title: "New cards",
    fields: [
      { key: "learnSteps", label: "Learning steps", help: "Delays between first looks, e.g. 1m 10m. Units: s m h d. Empty = no steps.", kind: "steps" },
      { key: "graduatingInterval", label: "Graduating interval", help: "Days until the first review after the last step.", kind: "int", min: 1, max: 365, unit: "days" },
      { key: "easyInterval", label: "Easy interval", help: "Days until the first review when a new card is answered Easy.", kind: "int", min: 1, max: 365, unit: "days" },
    ],
  },
  {
    title: "Lapses",
    fields: [
      { key: "relearnSteps", label: "Relearning steps", help: "Delays after forgetting a review card. Empty = straight back to review.", kind: "steps" },
      { key: "lapseFactor", label: "New interval", help: "Share of the old interval kept after a lapse. 0% = back to the minimum.", kind: "percent", min: 0, max: 100 },
      { key: "minInterval", label: "Minimum interval", help: "Shortest interval after a lapse.", kind: "int", min: 1, max: 365, unit: "days" },
      { key: "leechLapses", label: "Leech threshold", help: "Lapses before a card is tagged as a leech.", kind: "int", min: 1, max: 99, unit: "lapses" },
    ],
  },
  {
    title: "Advanced",
    fields: [
      { key: "maxInterval", label: "Maximum interval", help: "No interval grows past this.", kind: "int", min: 1, max: 36500, unit: "days" },
      { key: "startingEase", label: "Starting ease", help: "Ease a new card starts with (affects new cards only).", kind: "percent", min: 131, max: 500 },
      { key: "easyBonus", label: "Easy bonus", help: "Extra multiplier when you press Easy on a review.", kind: "percent", min: 100, max: 500 },
      { key: "hardFactor", label: "Hard interval", help: "Multiplier for Hard on a review (always at least +1 day).", kind: "percent", min: 50, max: 200 },
      { key: "intervalModifier", label: "Interval modifier", help: "Scales every review interval. 100% = unchanged.", kind: "percent", min: 50, max: 200 },
      { key: "learnAheadMinutes", label: "Learn ahead limit", help: "How early a session may show a learning card when nothing else is left.", kind: "int", min: 0, max: 1440, unit: "minutes" },
    ],
  },
];

const KINDS: { kind: CardKind; label: string; note: string }[] = [
  { kind: "question", label: "Questions", note: "Used by quizzes and flashcards, which share one card per question." },
  { kind: "exercise", label: "Exercises", note: "Rated when you finish an exercise; decides when it comes back for a redo." },
];

function display(f: Field, p: Preset): string {
  if (f.kind === "steps") return formatSteps(p[f.key]);
  if (f.kind === "percent") return String(Math.round(p[f.key] * 100));
  return String(p[f.key]);
}

function parse(f: Field, raw: string): { value?: Preset[keyof Preset]; error?: string } {
  if (f.kind === "steps") {
    const steps = parseSteps(raw);
    return steps ? { value: steps } : { error: "Use durations like 1m 10m 1d" };
  }
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || raw.trim() === "") return { error: "Enter a number" };
  if (f.kind === "int" && !Number.isInteger(n)) return { error: "Whole numbers only" };
  if (n < f.min || n > f.max) return { error: `Between ${f.min} and ${f.max}${f.kind === "percent" ? "%" : ""}` };
  return { value: f.kind === "percent" ? n / 100 : n };
}

export function SchedulingSettings() {
  return (
    <Tabs defaultValue="question">
      <TabsList>
        {KINDS.map((k) => (
          <TabsTrigger key={k.kind} value={k.kind}>
            {k.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {KINDS.map((k) => (
        <TabsContent key={k.kind} value={k.kind} className="mt-4">
          <KindForm kind={k.kind} note={k.note} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function KindForm({ kind, note }: { kind: CardKind; note: string }) {
  const { settings } = useProgress();
  const info = useScheduling();
  const overrides = settings.scheduling[kind] ?? {};
  // The server's view (engine + this course's defaults + overrides); the engine's alone until it loads.
  const preset = info?.effective[kind] ?? resolvePreset(kind, settings.scheduling);
  const defaults = info?.defaults[kind] ?? PRESETS[kind];
  const changed = Object.keys(overrides).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{note}</p>
        <Button variant="outline" size="sm" onClick={() => updateScheduling(kind, null)} disabled={!changed}>
          <RotateCcwIcon /> Reset to defaults
        </Button>
      </div>
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="space-y-3">
          <legend className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.title}</legend>
          {g.fields.map((f) => (
            <FieldRow key={`${kind}-${f.key}-${display(f, preset)}`} kind={kind} field={f} preset={preset} defaults={defaults} isChanged={f.key in overrides} />
          ))}
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">Changes apply to your next answers; existing schedules aren't recalculated (same as Anki).</p>
    </div>
  );
}

function FieldRow({ kind, field, preset, defaults, isChanged }: { kind: CardKind; field: Field; preset: Preset; defaults: Preset; isChanged: boolean }) {
  const [draft, setDraft] = useState(display(field, preset));
  const [error, setError] = useState<string | null>(null);
  const id = `sched-${kind}-${field.key}`;
  const defaultText = display(field, defaults);

  function save() {
    const { value, error } = parse(field, draft);
    if (error) return setError(error);
    setError(null);
    if (JSON.stringify(value) === JSON.stringify(preset[field.key])) return; // unchanged: nothing to send
    if (field.key === "easyInterval" && (value as number) < preset.graduatingInterval) {
      return setError("Should be at least the graduating interval");
    }
    updateScheduling(kind, { [field.key]: value } as Partial<Preset>);
  }

  const suffix = field.kind === "percent" ? "%" : field.kind === "int" ? field.unit : "";
  return (
    <div className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-start sm:gap-4">
      <label htmlFor={id} className="pt-1.5 text-sm">
        <span className="flex items-center gap-1.5">
          {isChanged ? <span className="size-1.5 rounded-full bg-primary" aria-label="changed" /> : null}
          {field.label}
        </span>
      </label>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Input
            id={id}
            value={draft}
            inputMode={field.kind === "steps" ? "text" : "numeric"}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), save())}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-help`}
            className={cn("h-8 font-mono", field.kind === "steps" ? "w-full sm:w-56" : "w-28")}
          />
          {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
        </div>
        <p id={`${id}-help`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? field.help}
          {!error && isChanged ? ` (default: ${defaultText || "none"}${suffix === "%" ? "%" : ""})` : ""}
        </p>
      </div>
    </div>
  );
}
