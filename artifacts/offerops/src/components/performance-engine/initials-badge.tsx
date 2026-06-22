export function InitialsBadge({
  initials,
  className = "",
  size = "md",
}: {
  initials: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-12 w-12 text-base" : "h-9 w-9 text-sm";
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-700 ${dim} ${className}`}
      aria-hidden
    >
      {initials.slice(0, 2).toUpperCase()}
    </div>
  );
}
