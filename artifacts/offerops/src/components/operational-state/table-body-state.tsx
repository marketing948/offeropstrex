import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { OperationalEmpty } from "@/components/operational-state/operational-empty";
import { OperationalError } from "@/components/operational-state/operational-error";

export function TableRowsSkeleton({
  rows = 5,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <TableRow key={r}>
          {Array.from({ length: cols }, (_, c) => (
            <TableCell key={c} className="py-3">
              <Skeleton className="h-4 w-full max-w-[8rem]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

/** Full-width table cell for empty / error outside normal row grid. */
export function TableSectionState({
  colSpan,
  variant,
  title,
  description,
  error,
  onRetry,
  retrying,
}: {
  colSpan: number;
  variant: "empty" | "error";
  title: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="p-0">
        <div className="p-4">
          {variant === "error" ? (
            <OperationalError
              title={title}
              description={description}
              error={error}
              onRetry={onRetry}
              retrying={retrying}
            />
          ) : (
            <OperationalEmpty title={title} description={description} compact />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
