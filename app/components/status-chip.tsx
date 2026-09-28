import { CheckCircle2Icon, CircleDashedIcon, CircleDotIcon } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import type { ChapterStatus } from "~/lib/mastery";
import { cn } from "~/lib/utils";

const CHIPS: Record<ChapterStatus, { label: string; icon: typeof CheckCircle2Icon; className: string }> = {
  "not-started": { label: "Not started", icon: CircleDashedIcon, className: "text-muted-foreground" },
  "in-progress": { label: "In progress", icon: CircleDotIcon, className: "text-foreground" },
  mastered: { label: "Mastered", icon: CheckCircle2Icon, className: "border-success/40 text-success" },
};

export function StatusChip({ status }: { status: ChapterStatus }) {
  const c = CHIPS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", c.className)}>
      <c.icon aria-hidden />
      {c.label}
    </Badge>
  );
}
