/**
 * Clickable, indicator-bearing table header built on the shadcn `TableHead`.
 * Pairs with `useTableSort` for client-side sortable tables.
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { TableSort } from "@/lib/use-table-sort";
import { cn } from "@/lib/utils";

export function SortableTableHead({
  label,
  col,
  sort,
  align = "left",
  className,
}: {
  label: string;
  col: string;
  sort: TableSort;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.col === col;
  return (
    <TableHead
      className={cn(
        "cursor-pointer select-none text-xs font-bold uppercase tracking-wide text-slate-500 hover:text-slate-800",
        align === "right" && "text-right",
        className,
      )}
      onClick={() => sort.toggle(col)}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
        {label}
        {active ? (
          sort.dir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </TableHead>
  );
}
