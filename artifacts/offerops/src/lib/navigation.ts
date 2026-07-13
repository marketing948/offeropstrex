import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CheckSquare,
  ClipboardCheck,
  FileBarChart,
  FolderTree,
  History,
  Layers,
  Radio,
  Settings,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Primary operational destination (slightly stronger default emphasis). */
  primary?: boolean;
};

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

/** Sidebar information architecture — single source of truth for labels and order. */
export function getNavigationSections(isAdmin: boolean): NavSection[] {
  const operations: NavItem[] = [
    { href: "/ops", label: "Operations Hub", icon: Layers, primary: true },
    { href: "/tasks", label: "Work Queue", icon: CheckSquare },
    { href: "/campaign-review", label: "Campaign Review", icon: ClipboardCheck },
    { href: "/testing-batches", label: "Batches", icon: FolderTree },
    { href: "/live-campaigns", label: "Live Campaigns", icon: Radio },
    { href: "/activity", label: "Activity", icon: History },
    { href: "/reports", label: "Reports", icon: FileBarChart },
  ];

  const sections: NavSection[] = [
    { id: "operations", label: "Operations", items: operations },
  ];

  if (isAdmin) {
    sections.push({
      id: "administration",
      label: "Administration",
      items: [
        { href: "/dashboard", label: "Executive Overview", icon: BarChart3 },
        { href: "/performance/monthly-goals", label: "Performance Engine", icon: Trophy },
        { href: "/ai-optimizer", label: "AI Optimizer", icon: Sparkles },
        { href: "/employees", label: "Team", icon: Users },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    });
  }

  return sections;
}

/** Legacy bookmarks — routes stay registered but redirect to canonical homes. */
export const LEGACY_ROUTE_REDIRECTS: Record<string, string> = {
  "/employee-dashboard": "/ops",
  "/mission-control": "/ops",
  "/daily-reports": "/reports",
  "/weekly-reports": "/reports",
};

export function isNavActive(location: string, href: string): boolean {
  if (href.startsWith("/performance") && location.startsWith("/performance")) {
    return href === "/performance/monthly-goals" || location === href || location.startsWith(`${href}/`);
  }
  return location === href || location.startsWith(`${href}/`);
}
