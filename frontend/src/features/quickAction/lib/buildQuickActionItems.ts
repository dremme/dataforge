import {
  folderLeafName,
  folderPathsEqual,
  normalizeFolderPath,
} from "@/features/folder/lib/folderPath";
import {
  isTrainLoraCoTrackedByExternal,
  jobIcon,
  jobTypeLabel,
  statusLabel,
} from "@/features/jobs/lib/jobs";
import {
  JOB_TYPE_META,
  PRIMARY_JOB_TYPE,
  SECONDARY_JOB_TYPES,
  isJobAvailable,
  jobTypeIconFor,
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import { iconBrain, iconFolder, iconStar, type AppIcon } from "@/shared/icons";
import type { ExternalOstrisJob, FolderFavorite, Job, JobType, Subfolder } from "@/shared/types";
import type { QuickActionItem, QuickActionSection } from "../types";

/** Every job type, primary first — the palette lists them all, unlike the "More" menu. */
export const ALL_JOB_TYPES: JobType[] = [PRIMARY_JOB_TYPE, ...SECONDARY_JOB_TYPES];

/**
 * Casing is preserved so the id can be rendered back as a path when the folder is
 * no longer in any live list; `quickActionHistory` folds case when comparing.
 */
export function quickActionFolderId(path: string): string {
  return `folder:${normalizeFolderPath(path)}`;
}

/** The path back out of a folder id, or null for any other kind of id. */
export function folderPathFromQuickActionId(id: string): string | null {
  if (!id.startsWith("folder:")) return null;

  const path = id.slice("folder:".length);
  return path.length > 0 ? path : null;
}

export function folderQuickAction(
  path: string,
  section: QuickActionSection,
  onNavigate: (path: string) => void,
  options: { name?: string; icon?: AppIcon } = {},
): QuickActionItem {
  const normalized = normalizeFolderPath(path);

  return {
    id: quickActionFolderId(normalized),
    section,
    label: options.name ?? folderLeafName(normalized),
    detail: normalized,
    icon: options.icon ?? iconFolder,
    run: () => onNavigate(normalized),
  };
}

export function buildSubfolderItems(
  subfolders: Subfolder[],
  onNavigate: (path: string) => void,
): QuickActionItem[] {
  return subfolders.map((subfolder) =>
    folderQuickAction(subfolder.path, "subfolders", onNavigate, { name: subfolder.name }),
  );
}

/**
 * Recents minus the folder already open and minus anything already listed as a
 * favorite, so the same folder never appears in two sections.
 */
export function buildRecentFolderItems(
  recentPaths: string[],
  currentFolder: string | undefined,
  favoritePaths: string[],
  onNavigate: (path: string) => void,
): QuickActionItem[] {
  return recentPaths
    .filter((path) => !currentFolder || !folderPathsEqual(path, currentFolder))
    .filter((path) => !favoritePaths.some((favorite) => folderPathsEqual(favorite, path)))
    .map((path) => folderQuickAction(path, "recentFolders", onNavigate));
}

export function buildFavoriteItems(
  favorites: FolderFavorite[],
  onNavigate: (path: string) => void,
): QuickActionItem[] {
  return favorites.map((favorite) =>
    folderQuickAction(favorite.path, "favorites", onNavigate, {
      name: favorite.name,
      icon: iconStar,
    }),
  );
}

/**
 * Selecting a job goes to the folder it ran on — the same thing clicking its card
 * in the jobs drawer does. Local rows co-tracked by an Ostris card are dropped for
 * the same reason the drawer drops them: one run, one row.
 */
export function buildJobItems(
  jobs: Job[],
  externalJobs: ExternalOstrisJob[],
  onNavigate: (path: string) => void,
): QuickActionItem[] {
  const externalItems = externalJobs
    .filter((job): job is ExternalOstrisJob & { dataset_folder: string } =>
      Boolean(job.dataset_folder),
    )
    .map<QuickActionItem>((job) => ({
      id: `job:ostris-${job.id}`,
      section: "jobs",
      label: job.dataset_folder_name || folderLeafName(job.dataset_folder),
      detail: `${JOB_TYPE_META.train_lora.label} · ${job.status}`,
      icon: iconBrain,
      keywords: `${job.dataset_folder} ${job.name}`,
      run: () => onNavigate(job.dataset_folder),
    }));

  const localItems = jobs
    .filter((job) => !isTrainLoraCoTrackedByExternal(job, externalJobs))
    .map<QuickActionItem>((job) => ({
      id: `job:${job.id}`,
      section: "jobs",
      label: job.folder_name || folderLeafName(job.folder),
      detail: `${jobTypeLabel(job)} · ${statusLabel(job)}`,
      icon: jobIcon(job),
      keywords: job.folder,
      run: () => onNavigate(job.folder),
    }));

  return [...externalItems, ...localItems];
}

export interface RunJobOptions {
  availability: JobAvailability;
  /** False while a job is already running in this folder. */
  canStart: boolean;
  hasFolder: boolean;
  onRequestStart: (jobType: JobType) => void;
}

/**
 * Routed through the automation host's `onRequestStart`, which is the same entry
 * point the automation panel's menu uses — so a job type with `startUi: "confirm"`
 * still gets its confirmation, and every other type still opens its dialog.
 */
export function buildRunJobItems({
  availability,
  canStart,
  hasFolder,
  onRequestStart,
}: RunJobOptions): QuickActionItem[] {
  return ALL_JOB_TYPES.map((type) => {
    const meta = JOB_TYPE_META[type] as {
      label: string;
      menuLabel?: string;
      menuDescription?: string;
    };

    return {
      id: `run:${type}`,
      section: "run",
      label: meta.menuLabel ?? meta.label,
      detail: meta.menuDescription,
      icon: jobTypeIconFor(type),
      // The menu label can differ from the registry label, so keep both matchable.
      keywords: meta.label,
      disabled: !hasFolder || !canStart || !isJobAvailable(type, availability),
      run: () => onRequestStart(type),
    };
  });
}
