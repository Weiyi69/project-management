import {
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  Settings2,
  type LucideIcon,
} from "@lucide/vue";

export interface NavigationItem {
  label: string;
  name: string;
  icon: LucideIcon;
}

export const mainNavigation: NavigationItem[] = [
  { label: "Overview", name: "overview", icon: LayoutDashboard },
  { label: "My tasks", name: "my-tasks", icon: ClipboardList },
  { label: "Inbox", name: "inbox", icon: Inbox },
  { label: "Projects", name: "projects", icon: FolderKanban },
  { label: "Calendar", name: "calendar", icon: CalendarDays },
  { label: "Analytics", name: "analytics", icon: ChartNoAxesCombined },
];

export const settingsNavigation: NavigationItem[] = [
  { label: "Settings", name: "settings", icon: Settings2 },
];
