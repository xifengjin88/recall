import { APP } from "~/config";
import { useRef, useState } from "react";
import { DownloadIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { SchedulingSettings } from "~/components/scheduling-settings";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Switch } from "~/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { SUBJECT, CHAPTERS } from "~/content";
import { today } from "~/lib/dates";
import { parseProgress, type ProgressData, type SessionLength, type SessionOrder, type Theme } from "~/lib/progress";
import type { RouteHandle } from "~/lib/shortcuts";
import {
  exportProgress,
  importProgress,
  resetProgress,
  updatePrefs,
  updateSettings,
  useProgress,
} from "~/state/progress-store";

export function meta() {
  return [{ title: `Settings · ${APP.name}` }];
}

export const handle: RouteHandle = { screen: "Settings", shortcuts: [] };

export default function Settings() {
  const p = useProgress();

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Section title="Appearance">
        <Row label="Theme">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.settings.theme} onValueChange={(v) => v && updateSettings({ theme: v as Theme })}>
            <ToggleGroupItem value="system">System</ToggleGroupItem>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="Show keyboard hints" htmlFor="key-hints">
          <Switch id="key-hints" checked={p.settings.showKeyHints} onCheckedChange={(c) => updateSettings({ showKeyHints: c })} />
        </Row>
      </Section>

      <Section title="Sessions" description="Defaults for the session setup panel. Changing them there updates these too.">
        <Row label="Default length">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(p.prefs.length)}
            onValueChange={(v) => v && updatePrefs({ length: (v === "all" ? "all" : Number(v)) as SessionLength })}
          >
            <ToggleGroupItem value="10">10</ToggleGroupItem>
            <ToggleGroupItem value="20">20</ToggleGroupItem>
            <ToggleGroupItem value="all">All</ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="Default order">
          <ToggleGroup type="single" variant="outline" size="sm" value={p.prefs.order} onValueChange={(v) => v && updatePrefs({ order: v as SessionOrder })}>
            <ToggleGroupItem value="shuffled">Shuffled</ToggleGroupItem>
            <ToggleGroupItem value="book">Book order</ToggleGroupItem>
          </ToggleGroup>
        </Row>
      </Section>


      <Section
        title="Scheduling"
        description="How spaced repetition schedules your reviews, like Anki's deck options. Defaults are Anki's."
      >
        <SchedulingSettings />
      </Section>

      <Section title="Progress" description="Progress is kept by the Recall server for this course. Export it to back up, or import a file from another install.">
        <ExportImport />
      </Section>

      <Section title="Reset">
        <ResetControls />
      </Section>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
      <Separator />
    </section>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function ExportImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  // `raw` goes to the server as-is (it accepts current and old export formats); `data` is for the summary.
  const [pending, setPending] = useState<{ name: string; raw: unknown; data: ProgressData } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function download() {
    let file: unknown;
    try {
      file = await exportProgress();
    } catch {
      setMessage({ ok: false, text: "Couldn't export: the server didn't answer." });
      return;
    }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP.id}-${SUBJECT.id}-progress-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function choose(file: File | undefined) {
    setMessage(null);
    if (!file) return;
    try {
      const raw: unknown = JSON.parse(await file.text());
      const data = parseProgress(raw);
      if (!data) throw new Error();
      setPending({ name: file.name, raw, data });
    } catch {
      setMessage({ ok: false, text: `${file.name} isn't a ${APP.name} progress export.` });
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function apply(mode: "replace" | "merge") {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const skipped = await importProgress(pending.raw, mode);
      const done = mode === "replace" ? "Progress replaced from the file." : "File merged into your progress.";
      const note = skipped ? ` ${skipped} record${skipped === 1 ? "" : "s"} for items this course no longer has were skipped.` : "";
      setMessage({ ok: true, text: done + note });
      setPending(null);
    } catch (err) {
      setMessage({ ok: false, text: `Import failed: ${err instanceof Error ? err.message : "unknown error"}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={download}>
          <DownloadIcon /> Export progress
        </Button>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <UploadIcon /> Import progress…
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      {pending ? (
        <Alert>
          <AlertTitle>Import {pending.name}?</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              It has {Object.keys(pending.data.cards).length} cards and {pending.data.reviews.length} reviews.{" "}
              <strong>Replace</strong> discards your current progress in this course; <strong>Merge</strong> keeps the most recent record for each item.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => apply("replace")}>
                Replace
              </Button>
              <Button size="sm" disabled={busy} onClick={() => apply("merge")}>
                Merge
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <p role="status" className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function ResetControls() {
  const [target, setTarget] = useState<string>(CHAPTERS[0] ? String(CHAPTERS[0].number) : "all");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const label = target === "all" ? "all progress, exercise statuses and history" : `all progress for Chapter ${target}`;

  async function reset() {
    setConfirming(false);
    try {
      await resetProgress(target === "all" ? undefined : Number(target));
      setDone(target === "all" ? "Everything was reset." : `Chapter ${target} was reset.`);
    } catch {
      setDone("Reset failed: the server didn't answer.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="reset-target" className="sr-only">
          What to reset
        </Label>
        <select
          id="reset-target"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setConfirming(false);
          }}
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {CHAPTERS.map((c) => (
            <option key={c.number} value={c.number}>
              Chapter {c.number}: {c.title}
            </option>
          ))}
          <option value="all">Everything</option>
        </select>
        <Button variant="destructive" onClick={() => (setConfirming(true), setDone(null))} disabled={confirming}>
          Reset…
        </Button>
      </div>
      {confirming ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>This deletes {label}.</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>It can't be undone. Export first if you might want it back. Settings are kept.</p>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" onClick={reset}>
                Yes, reset
              </Button>
              <Button size="sm" variant="outline" autoFocus onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-muted-foreground">
          {done}
        </p>
      ) : null}
    </div>
  );
}
