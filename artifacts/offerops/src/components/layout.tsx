import { useAuth } from "@/lib/auth";
import { routeForNotification } from "@/lib/entity-navigation";
import { queryOpts } from "@/lib/ws-query";
import { Link, useLocation } from "wouter";
import {
  Users,
  LogOut,
  Bell,
  ChevronsUpDown,
  Building2,
  Check,
} from "lucide-react";
import { getNavigationSections, isNavActive } from "@/lib/navigation";
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { CurrentRankCard } from "@/components/performance-engine/current-rank-card";
import { useCurrentRank } from "@/lib/performance-engine/use-current-rank";

function WorkspaceSwitcher() {
  const { currentEmployee } = useAuth();
  const isAdmin = currentEmployee?.role === "admin";
  const [open, setOpen] = useState(false);
  const wsRef = useRef<HTMLDivElement>(null);
  const {
    availableWorkspaces,
    workspaceLabel,
    isLoading,
    canSwitchWorkspace,
    switchWorkspace,
    isSwitchingWorkspace,
  } = useWorkspace();

  const activeInitial = workspaceLabel.charAt(0).toUpperCase();
  const wsCount = availableWorkspaces.length;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={wsRef}
      className="relative px-2.5 pt-2.5 pb-2 border-b"
      style={{ borderColor: "hsl(var(--sidebar-border))" }}
    >
      <span
        className="block px-1 mb-1 text-[9px] font-semibold uppercase tracking-wider"
        style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }}
      >
        Workspace
      </span>
      <button
        type="button"
        disabled={!canSwitchWorkspace || isLoading}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          canSwitchWorkspace
            ? `Switch workspace. Current: ${workspaceLabel}`
            : `Current workspace: ${workspaceLabel}`
        }
        className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${canSwitchWorkspace ? "cursor-pointer" : "cursor-default"}`}
        style={{
          background: open ? "hsl(var(--sidebar-accent))" : "hsl(var(--sidebar-foreground) / 0.06)",
          outline: open ? "1px solid hsl(var(--sidebar-primary) / 0.5)" : "1px solid hsl(var(--sidebar-foreground) / 0.08)",
        }}
        onClick={() => canSwitchWorkspace && setOpen((v) => !v)}
        onMouseEnter={e => {
          if (canSwitchWorkspace && !open) {
            (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-foreground) / 0.1)";
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-foreground) / 0.06)";
          }
        }}
      >
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 text-sm font-bold"
          style={{
            background: "hsl(var(--sidebar-primary))",
            color: "hsl(var(--sidebar-primary-foreground))",
          }}
        >
          {activeInitial}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span
            className="text-[13px] font-semibold truncate leading-tight"
            style={{ color: "hsl(var(--sidebar-foreground))" }}
          >
            {isLoading ? "Loading…" : workspaceLabel}
          </span>
          <span
            className="text-[10px] leading-tight truncate mt-0.5"
            style={{ color: "hsl(var(--sidebar-foreground) / 0.55)" }}
          >
            {isLoading
              ? "Workspace configuration"
              : canSwitchWorkspace
                ? `${wsCount} workspaces · click to switch`
                : "Single workspace"}
          </span>
        </div>
        {canSwitchWorkspace && (
          <>
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 min-w-[18px] text-center"
              style={{
                background: "hsl(var(--sidebar-primary))",
                color: "hsl(var(--sidebar-primary-foreground))",
              }}
            >
              {wsCount}
            </span>
            <ChevronsUpDown
              size={14}
              strokeWidth={2.25}
              style={{ color: "hsl(var(--sidebar-foreground) / 0.7)", flexShrink: 0 }}
            />
          </>
        )}
      </button>

      {open && canSwitchWorkspace && (
        <div
          className="absolute top-full left-2.5 right-2.5 mt-1 z-50 rounded-lg shadow-2xl border border-border bg-background overflow-hidden"
          role="listbox"
        >
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <Building2 size={12} className="text-muted-foreground flex-shrink-0" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex-1">OfferOps · Workspaces</p>
            <span className="text-[10px] text-muted-foreground">{wsCount}</span>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {availableWorkspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                role="option"
                aria-selected={ws.isActive}
                disabled={isSwitchingWorkspace}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors disabled:opacity-60"
                style={{
                  background: ws.isActive ? "hsl(var(--primary) / 0.08)" : "transparent",
                }}
                onMouseEnter={e => {
                  if (!ws.isActive) {
                    (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted) / 0.7)";
                  }
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = ws.isActive ? "hsl(var(--primary) / 0.08)" : "transparent";
                }}
                onClick={() => {
                  if (!ws.isActive) switchWorkspace(ws.id);
                  setOpen(false);
                }}
              >
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
                    ws.isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {ws.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[13px] truncate ${ws.isActive ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
                    {ws.name}
                  </p>
                  {ws.syncStatus === "success" && ws.lastSyncAt ? (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {ws.trafficSourcesSynced} sources · {ws.networksSynced} networks
                    </p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground truncate">Not synced</p>
                  )}
                </div>
                {ws.isActive && (
                  <Check size={14} className="text-primary flex-shrink-0" strokeWidth={3} />
                )}
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="border-t border-border px-3 py-2">
              <Link
                href="/settings"
                className="block text-[11px] font-medium text-primary hover:underline"
                onClick={() => setOpen(false)}
              >
                Manage workspaces →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { currentEmployee, logout, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [notifOpen]);

  const { activeWorkspaceId: notifWsId } = useWorkspace();
  const notifParams = {
    workspace_id: notifWsId ?? 0,
    employee_id: currentEmployee?.id ?? 0,
  };
  const { data: notifications } = useListNotifications(
    notifParams,
    queryOpts(getListNotificationsQueryKey(notifParams), { enabled: !!currentEmployee && !!notifWsId, refetchInterval: 30000 }),
  );
  const unreadCount = notifications?.filter(n => !n.read).length ?? 0;

  const markAllRead = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListNotificationsQueryKey({ workspace_id: notifWsId ?? 0, employee_id: currentEmployee?.id ?? 0 }) }),
    },
  });
  const markOneRead = useMarkNotificationRead({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getListNotificationsQueryKey({ workspace_id: notifWsId ?? 0, employee_id: currentEmployee?.id ?? 0 }) }),
    },
  });

  const rankData = useCurrentRank();

  if (isLoading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!currentEmployee) {
    return <>{children}</>;
  }

  const isAdmin = currentEmployee.role === "admin";
  const showWorkerRank = !isAdmin;

  const navSections = getNavigationSections(isAdmin);
  const opsPath = location.split("?")[0] ?? location;
  const isOpsHub = opsPath === "/ops" || opsPath === "/operations";
  const isPerformanceEngine = opsPath.startsWith("/performance");

  // Phase 9e: Bible §9 notification taxonomy. Severity drives the
  // colored ring around the icon (info/warning/high/critical), the
  // glyph itself just hints at the type.
  const NOTIF_ICONS: Record<string, string> = {
    NEW_BATCH_CREATED:           "🆕",
    TRACKER_CAMPAIGN_MISSING:    "📡",
    INVALID_TAG:                 "🏷️",
    DUPLICATE_TRACKER_CAMPAIGN:  "♊",
    SUSPICIOUS_BATCH_UPDATE:     "⚠️",
    API_SYNC_FAILURE:            "⛔",
    TASK_OVERDUE:                "⏰",
  };
  const SEVERITY_CLS: Record<string, string> = {
    info:     "ring-blue-300 bg-blue-50",
    warning:  "ring-amber-300 bg-amber-50",
    high:     "ring-orange-400 bg-orange-50",
    critical: "ring-red-500 bg-red-50",
  };

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-60 flex flex-col" style={{ background: "hsl(var(--sidebar))" }}>

        {/* Workspace switcher (top) */}
        <WorkspaceSwitcher />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4" aria-label="Main navigation">
          {navSections.map((section) => (
            <div key={section.id}>
              <p
                className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-widest"
                style={{ color: "hsl(var(--sidebar-foreground) / 0.4)" }}
              >
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = isNavActive(location, item.href);
                  const mutedOpacity = item.primary ? 0.85 : 0.65;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
                        style={
                          isActive
                            ? {
                                background: "hsl(var(--sidebar-primary))",
                                color: "hsl(var(--sidebar-primary-foreground))",
                              }
                            : {
                                color: `hsl(var(--sidebar-foreground) / ${mutedOpacity})`,
                              }
                        }
                        onMouseEnter={(e) => {
                          if (!isActive) {
                            (e.currentTarget as HTMLElement).style.background =
                              "hsl(var(--sidebar-accent))";
                            (e.currentTarget as HTMLElement).style.color =
                              "hsl(var(--sidebar-accent-foreground))";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) {
                            (e.currentTarget as HTMLElement).style.background = "";
                            (e.currentTarget as HTMLElement).style.color = `hsl(var(--sidebar-foreground) / ${mutedOpacity})`;
                          }
                        }}
                      >
                        <item.icon size={17} aria-hidden />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
          {showWorkerRank && (
            <div className="mb-3">
              <CurrentRankCard
                variant="sidebar"
                rank={rankData.rank}
                nextRank={rankData.nextRank}
                myXp={rankData.myXp}
                progressToNext={rankData.progressToNext}
                xpReady={rankData.xpReady}
              />
            </div>
          )}
          {/* Notification bell */}
          <div ref={notifRef} className="relative mb-1">
            <button
              onClick={() => setNotifOpen(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{ color: "hsl(var(--sidebar-foreground) / 0.7)" }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent))";
                (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground))";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "";
                (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground) / 0.7)";
              }}
            >
              <Bell size={15} />
              Notifications
              {unreadCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div
                className="absolute bottom-full left-0 right-0 mb-1 rounded-xl shadow-2xl border border-border bg-white z-50 overflow-hidden"
                style={{ minWidth: "260px" }}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold text-foreground">Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => notifWsId && markAllRead.mutate({ data: { employeeId: currentEmployee.id, workspaceId: notifWsId } })}
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {!notifications || notifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No notifications</p>
                  ) : (
                    notifications.slice(0, 15).map(n => {
                      const sev = (n as any).severity ?? "info";
                      const sevCls = SEVERITY_CLS[sev] ?? SEVERITY_CLS.info;
                      return (
                      <div
                        key={n.id}
                        className={`flex gap-2 px-3 py-2.5 border-b border-border last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${!n.read ? "bg-blue-50/60" : ""}`}
                        onClick={() => {
                          if (!n.read) markOneRead.mutate({ id: n.id });
                          setNotifOpen(false);
                          setLocation(routeForNotification(n));
                        }}
                      >
                        <span
                          className={`text-sm flex-shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center ring-2 ${sevCls}`}
                          title={`${n.type} · ${sev}`}
                        >
                          {NOTIF_ICONS[n.type] ?? "🔔"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-foreground leading-snug">{n.message}</p>
                          {n.batchName && <p className="text-[10px] text-muted-foreground mt-0.5">{n.batchName}</p>}
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(n.createdAt).toLocaleDateString()}{" "}
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                        {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile link */}
          <Link
            href="/profile"
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors mb-0.5"
            style={{
              color: location === "/profile"
                ? "hsl(var(--sidebar-primary-foreground))"
                : "hsl(var(--sidebar-foreground) / 0.7)",
              background: location === "/profile" ? "hsl(var(--sidebar-primary))" : "",
            }}
            onMouseEnter={e => {
              if (location !== "/profile") {
                (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent))";
                (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground))";
              }
            }}
            onMouseLeave={e => {
              if (location !== "/profile") {
                (e.currentTarget as HTMLElement).style.background = "";
                (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground) / 0.7)";
              }
            }}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0"
              style={{ background: "hsl(var(--sidebar-primary) / 0.3)", color: "hsl(var(--sidebar-primary))" }}
            >
              {currentEmployee.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-col min-w-0 flex">
              <span className="truncate text-xs font-medium leading-tight" style={{ color: "hsl(var(--sidebar-foreground))" }}>
                {currentEmployee.name}
              </span>
              <span className="text-[10px] capitalize leading-tight" style={{ color: "hsl(var(--sidebar-foreground) / 0.45)" }}>
                {currentEmployee.role} · My Goals
              </span>
            </div>
          </Link>

          {/* Sign out */}
          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
            style={{ color: "hsl(var(--sidebar-foreground) / 0.45)" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent))";
              (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground))";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "";
              (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground) / 0.45)";
            }}
          >
            <LogOut size={15} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content — single vertical scroll container for all routes */}
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
        {isOpsHub || isPerformanceEngine ? (
          children
        ) : (
          <div className="p-8">
            <div className="mx-auto max-w-6xl">{children}</div>
          </div>
        )}
      </main>
    </div>
  );
}
