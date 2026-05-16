import { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VoluumItem {
  voluumId: string;
  name: string;
  isActive: boolean;
}

interface VoluumEntitySelectProps {
  items: VoluumItem[];
  value: string;
  onSelect: (voluumId: string, name: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
}

export function VoluumEntitySelect({
  items,
  value,
  onSelect,
  placeholder = "Select…",
  isLoading = false,
  className,
}: VoluumEntitySelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const activeItems = items
    .filter(i => i.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  const filtered = search.trim()
    ? activeItems.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    : activeItems;

  const selected = activeItems.find(i => i.voluumId === value);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function handleSelect(voluumId: string, name: string) {
    onSelect(voluumId, name);
    setOpen(false);
    setSearch("");
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={isLoading}
        onClick={() => { if (!isLoading) setOpen(o => !o); }}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
          "hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          !selected && "text-muted-foreground",
        )}
      >
        <span className="truncate">
          {isLoading ? "Loading…" : selected?.name ?? placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 ml-2" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-[200] mt-1 rounded-md border bg-popover text-popover-foreground shadow-md overflow-hidden">
          {activeItems.length === 0 ? (
            <div className="py-6 px-4 text-center text-xs text-muted-foreground">
              <AlertCircle className="mx-auto mb-2 h-5 w-5 text-amber-500" />
              <p className="font-medium text-amber-700 text-sm">No Voluum entities synced yet</p>
              <p className="mt-1">Go to Settings → Workspace to sync traffic sources and affiliate networks.</p>
            </div>
          ) : (
            <>
              <div className="p-2 border-b">
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") { setOpen(false); setSearch(""); } }}
                  placeholder="Search…"
                  className="flex h-8 w-full rounded-sm border border-input bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {filtered.length === 0 ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">No match found.</div>
                ) : (
                  filtered.map(item => (
                    <button
                      key={item.voluumId}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault();
                        handleSelect(item.voluumId, item.name);
                      }}
                      className={cn(
                        "flex w-full items-center px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground text-left",
                        value === item.voluumId && "bg-accent/50",
                      )}
                    >
                      <Check className={cn("mr-2 h-3.5 w-3.5 flex-shrink-0", value === item.voluumId ? "opacity-100" : "opacity-0")} />
                      {item.name}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MissingVoluumBadge({ label }: { label?: string }) {
  return (
    <span
      title="Not linked to a Voluum entity — edit to select from synced Voluum data"
      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 font-medium whitespace-nowrap"
    >
      <AlertCircle className="h-2.5 w-2.5 flex-shrink-0" />
      {label ?? "No Voluum link"}
    </span>
  );
}
