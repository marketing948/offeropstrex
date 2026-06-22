export function SegmentedProgress({
  filled,
  total = 5,
  status,
}: {
  filled: number;
  total?: number;
  status: "Strong" | "On track" | "Watch" | "Behind";
}) {
  const color =
    status === "Strong" || status === "On track"
      ? "bg-green-500"
      : status === "Watch"
        ? "bg-amber-400"
        : status === "Behind"
          ? "bg-red-500"
          : "bg-slate-200";

  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-sm ${i < filled ? color : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}
