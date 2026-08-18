import type { AppIcon } from "@/shared/icons";

/** Result groups, in the order they render once a query is typed. */
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
  /**
   * Stable across sessions — it is what the recent-actions list persists.
   * Shapes: `folder:<path>`, `job:<jobId>`, `run:<jobType>`, `cmd:<key>`.
   */
  id: string;
  section: QuickActionSection;
  /** Primary line, and the text the ranking scores first. */
  label: string;
  /** Secondary line: a path, a job status, or a one-line description. */
  detail?: string;
  icon: AppIcon;
  /** Matchable but not displayed — a job's full folder path, command synonyms. */
  keywords?: string;
  /** Listed but not selectable: the job already runs here, or the folder has none. */
  disabled?: boolean;
  run: () => void;
}

/** One rendered group. Decoupled from `QuickActionSection` so the empty-query
 *  "Recent" list, which spans sections, can be a group too. */
export interface QuickActionGroup {
  id: string;
  label: string;
  items: QuickActionItem[];
}
