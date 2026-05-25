import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { ExecutiveAlert, AlertSeverity } from "@/lib/executive-dashboard";
import { cn } from "@/lib/utils";

const SEVERITY_STYLES: Record<
  AlertSeverity,
  { border: string; bg: string; dot: string }
> = {
  critical: {
    border: "border-amber-300/70 dark:border-amber-800",
    bg: "bg-amber-50/80 dark:bg-amber-950/30",
    dot: "bg-amber-500",
  },
  high: {
    border: "border-orange-200/80 dark:border-orange-900/50",
    bg: "bg-orange-50/60 dark:bg-orange-950/25",
    dot: "bg-orange-500",
  },
  medium: {
    border: "border-border",
    bg: "bg-muted/30",
    dot: "bg-muted-foreground/50",
  },
  low: {
    border: "border-border/80",
    bg: "bg-card",
    dot: "bg-muted-foreground/35",
  },
};

export function AlertCard({ alert }: { alert: ExecutiveAlert }) {
  const s = SEVERITY_STYLES[alert.severity];
  return (
    <Link
      href={alert.href}
      className={cn(
        "group flex gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/30 hover:shadow-sm",
        s.border,
        s.bg,
      )}
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", s.dot)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug text-foreground">{alert.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
        {alert.meta && (
          <p className="mt-1 text-[10px] font-medium text-muted-foreground/80">{alert.meta}</p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
