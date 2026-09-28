import { APP } from "~/config";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useMatches, useNavigate } from "react-router";
import { InfoIcon, KeyboardIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Kbd } from "~/components/kbd";
import { SUBJECT, CONTENT_ERRORS } from "~/content";
import { useHotkeys } from "~/hooks/use-hotkeys";
import { GLOBAL_SHORTCUTS, type RouteHandle, type Shortcut } from "~/lib/shortcuts";
import { cn } from "~/lib/utils";
import { dismissNotice, initProgress, useProgress, useStoreStatus, type Notice } from "~/state/progress-store";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/exercises", label: "Exercises" },
  { to: "/stats", label: "Stats" },
  { to: "/settings", label: "Settings" },
];

// Every screen needs progress, so load it (from IndexedDB) before any of them render.
export async function clientLoader() {
  await initProgress();
  return null;
}

export default function Shell() {
  const navigate = useNavigate();
  const [helpOpen, setHelpOpen] = useState(false);
  const pendingG = useRef<number | null>(null);

  useThemeSync();

  // "g h" / "g s": a g arms the sequence for one second.
  useHotkeys({
    g: () => {
      pendingG.current = window.setTimeout(() => (pendingG.current = null), 1000);
    },
    h: (e) => goIfPending(e, "/"),
    s: (e) => goIfPending(e, "/stats"),
    "?": () => setHelpOpen(true),
  });
  function goIfPending(_e: KeyboardEvent, to: string) {
    if (pendingG.current === null) return;
    clearTimeout(pendingG.current);
    pendingG.current = null;
    navigate(to);
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <NavLink to="/" className="mr-auto flex items-center gap-2 text-sm font-semibold tracking-tight">
            {APP.name}
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">{SUBJECT.short}</span>
          </NavLink>
          <nav aria-label="Main" className="flex items-center gap-0.5 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-muted font-medium text-foreground",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
            <KeyboardIcon />
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 pt-4 empty:hidden">
        <ContentErrors />
        <StoreNotice />
      </div>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

function useThemeSync() {
  const { settings } = useProgress();
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", settings.theme === "dark" || (settings.theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [settings.theme]);
}

/** Spec §5.5: full list in development, a small collapsed banner otherwise. */
function ContentErrors() {
  if (!CONTENT_ERRORS.length) return null;
  return (
    <Alert className="border-warning/50">
      <TriangleAlertIcon className="text-warning" />
      <Collapsible defaultOpen={import.meta.env.DEV} className="col-start-2">
        <AlertTitle className="flex items-center gap-2">
          {CONTENT_ERRORS.length} content {CONTENT_ERRORS.length === 1 ? "problem" : "problems"}. Affected items are skipped.
          <CollapsibleTrigger asChild>
            <Button variant="link" size="xs" className="h-auto p-0">
              details
            </Button>
          </CollapsibleTrigger>
        </AlertTitle>
        <CollapsibleContent>
          <AlertDescription>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {CONTENT_ERRORS.map((e, i) => (
                <li key={i}>
                  <span className="text-foreground">{e.where}</span>: {e.message}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </CollapsibleContent>
      </Collapsible>
    </Alert>
  );
}

const NOTICES: Record<Exclude<Notice, null>, { title: string; text: string; tone: "info" | "warn" }> = {
  migrated: {
    title: "Progress moved",
    text: "Your saved progress now lives in this browser's database (IndexedDB). A backup of the old copy was kept.",
    tone: "info",
  },
  "no-storage": {
    title: "Progress won't be saved",
    text: "This browser won't let the app store data (private window or blocked site data?). You can still study, but progress is lost on reload.",
    tone: "warn",
  },
  "save-failed": {
    title: "Couldn't save progress",
    text: "The last change didn't reach storage. Export your progress from Settings to be safe.",
    tone: "warn",
  },
};

function StoreNotice() {
  const { notice } = useStoreStatus();
  if (!notice) return null;
  const n = NOTICES[notice];
  return (
    <Alert role="status" variant={n.tone === "warn" ? "destructive" : "default"}>
      {n.tone === "warn" ? <TriangleAlertIcon /> : <InfoIcon />}
      <AlertTitle>{n.title}</AlertTitle>
      <AlertDescription>{n.text}</AlertDescription>
      <Button variant="ghost" size="icon-xs" className="absolute top-2 right-2" onClick={dismissNotice} aria-label="Dismiss">
        <XIcon />
      </Button>
    </Alert>
  );
}

function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const matches = useMatches();
  const handle = [...matches].reverse().find((m) => (m.handle as RouteHandle | undefined)?.shortcuts)?.handle as
    | RouteHandle
    | undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts pause while you're typing in a text field, except Enter and Esc.</DialogDescription>
        </DialogHeader>
        {handle?.shortcuts?.length ? <ShortcutList title={handle.screen ?? "This screen"} items={handle.shortcuts} /> : null}
        <ShortcutList title="Anywhere" items={GLOBAL_SHORTCUTS} />
      </DialogContent>
    </Dialog>
  );
}

function ShortcutList({ title, items }: { title: string; items: Shortcut[] }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <dl className="space-y-1.5 text-sm">
        {items.map((s) => (
          <div key={s.label} className="flex items-center justify-between gap-4">
            <dt>{s.label}</dt>
            <dd className="flex shrink-0 gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
