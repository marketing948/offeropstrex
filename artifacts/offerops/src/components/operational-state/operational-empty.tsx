import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OperationalEmpty({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  className,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <Empty
      className={cn(
        "border border-dashed border-border bg-muted/15",
        compact ? "py-8 md:p-8" : "py-10 md:p-10",
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className="text-muted-foreground" aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold">{title}</EmptyTitle>
        {description && (
          <EmptyDescription className="text-pretty">{description}</EmptyDescription>
        )}
      </EmptyHeader>
      {actionLabel && onAction && (
        <EmptyContent>
          <Button type="button" variant="outline" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  );
}
