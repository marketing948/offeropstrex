import { Link } from "wouter";
import { ArrowRight } from "lucide-react";

export function LegacyRouteBanner({
  title,
  description,
  canonicalHref,
  canonicalLabel,
}: {
  title: string;
  description: string;
  canonicalHref: string;
  canonicalLabel: string;
}) {
  return (
    <div
      className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/25"
      role="status"
    >
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{description}</p>
      <Link
        href={canonicalHref}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        {canonicalLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
