import { cn } from "@/lib/utils";

export function RefreshingHint({
  visible,
  className,
}: {
  visible: boolean;
  className?: string;
}) {
  if (!visible) return null;
  return (
    <p
      className={cn("text-xs text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      Refreshing…
    </p>
  );
}
