import type { AppIcon } from "@/shared/icons";

export const QUICK_ACTION_SECTIONS = [
  { id: "run", label: "Run a job" },
  { id: "commands", label: "Commands" },
  { id: "subfolders", label: "Subfolders" },
  { id: "recentFolders", label: "Recent folders" },
  { id: "favorites", label: "Favorites" },
  { id: "jobs", label: "Recent jobs" },
] as const;

export type QuickActionSection = (typeof QUICK_ACTION_SECTIONS)[number]["id"];

export interface QuickActionItem {
  id: string;
  section: QuickActionSection;
  label: string;
  detail?: string;
  icon: AppIcon;
  keywords?: string;
  disabled?: boolean;
  run: () => void;
}

export interface QuickActionGroup {
  id: string;
  label: string;
  items: QuickActionItem[];
}
