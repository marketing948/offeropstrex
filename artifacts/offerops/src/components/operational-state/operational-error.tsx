import type { LucideIcon } from "lucide-react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { operationalErrorMessage } from "@/lib/operational-feedback";
import { cn } from "@/lib/utils";

export function OperationalError({
  title,
  description,
  error,
  onRetry,
  retrying,
  icon: Icon = AlertCircle,
  className,
}: {
  title: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  icon?: LucideIcon;
  className?: string;
}) {
  const detail = error != null ? operationalErrorMessage(error, title) : description;

  return (
    <div
      className={cn(
        "rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-5",
        className,
      )}
      role="alert"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Icon className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {detail && detail !== title && (
            <p className="text-sm text-muted-foreground">{detail}</p>
          )}
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 border-destructive/30"
            onClick={() => void onRetry()}
            disabled={retrying}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
