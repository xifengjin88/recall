import { cn } from "~/lib/utils";
import { useProgress } from "~/state/progress-store";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 bg-muted px-1 font-mono text-[0.7rem] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A key hint that respects the "show keyboard hints" setting. */
export function KeyHint({ children, className }: { children: React.ReactNode; className?: string }) {
  const { settings } = useProgress();
  if (!settings.showKeyHints) return null;
  return (
    <Kbd className={cn("hidden sm:inline-flex", className)} aria-hidden>
      {children}
    </Kbd>
  );
}
