import type { LucideIcon } from "lucide-react";
import {
  CheckSquare,
  FileBarChart,
  FolderTree,
  History,
  Layers,
  Radio,
  Settings,
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
        { href: "/employees", label: "Team", icon: Users },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    });
  }

  return sections;
}

/** Legacy bookmarks — routes stay registered but redirect to canonical homes. */
export const LEGACY_ROUTE_REDIRECTS: Record<string, string> = {
  "/dashboard": "/ops",
  "/employee-dashboard": "/ops",
  "/performance": "/ops",
  "/mission-control": "/ops",
  "/daily-reports": "/reports",
  "/weekly-reports": "/reports",
};

export function isNavActive(location: string, href: string): boolean {
  return location === href || location.startsWith(`${href}/`);
}
