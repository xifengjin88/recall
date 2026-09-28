import { Progress } from "~/components/ui/progress";
import type { Mastery } from "~/lib/mastery";
import { cn } from "~/lib/utils";

export function MasteryBar({ m, className, label }: { m: Mastery; className?: string; label?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress value={m.percent} className="h-1.5" aria-label={label ?? "Mastery"} />
      <span className="w-10 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">{m.percent}%</span>
    </div>
  );
}
