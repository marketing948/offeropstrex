import type { ReportBreakdownItem } from "@/lib/reports/reports-data";

export function ReportBreakdownChips({
  items,
  maxVisible = 2,
}: {
  items: ReportBreakdownItem[];
  maxVisible?: number;
}) {
  if (items.length === 0) {
    return <span className="text-[10px] text-slate-400">—</span>;
  }

  const visible = items.slice(0, maxVisible);
  const rest = items.length - maxVisible;
  const fullTitle = items.map((i) => `${i.label} · ${i.count}`).join(", ");

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" title={fullTitle}>
      {visible.map((i) => (
        <span
          key={i.label}
          className="inline-block max-w-full truncate rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700"
        >
          {i.label} · {i.count}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-slate-500">+{rest} more</span>}
    </div>
  );
}
