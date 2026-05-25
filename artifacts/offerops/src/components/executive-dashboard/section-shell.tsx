import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardSection({
  id,
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("space-y-3", className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="flex items-start gap-2">
        {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <div>
          <h2
            id={id ? `${id}-title` : undefined}
            className="text-sm font-bold uppercase tracking-widest text-foreground"
          >
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
