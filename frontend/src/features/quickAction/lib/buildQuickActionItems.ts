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
import {
  SIDECAR_SWEEP_COPY,
  SIDECAR_SWEEP_KINDS,
  sidecarSweepDetail,
} from "@/features/gallery/lib/sidecarSweep";
import {
  iconArrowLeftRight,
  iconBrain,
  iconCopy,
  iconFolder,
  iconFolderInput,
  iconListChecks,
  iconStar,
  iconTrash2,
  type AppIcon,
} from "@/shared/icons";
import type {
  ExternalOstrisJob,
  FolderFavorite,
  Job,
  JobType,
  SidecarKind,
  Subfolder,
} from "@/shared/types";
import type { QuickActionItem, QuickActionSection } from "../types";

export const ALL_JOB_TYPES: JobType[] = [PRIMARY_JOB_TYPE, ...SECONDARY_JOB_TYPES];

export function quickActionFolderId(path: string): string {
  return `folder:${normalizeFolderPath(path)}`;
}

export function quickActionRunJobId(type: JobType): string {
  return `run:${type}`;
}

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
  canStart: boolean;
  hasFolder: boolean;
  onRequestStart: (jobType: JobType) => void;
}

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
      id: quickActionRunJobId(type),
      section: "run",
      label: meta.menuLabel ?? meta.label,
      detail: meta.menuDescription,
      icon: jobTypeIconFor(type),
      keywords: meta.label,
      disabled: !hasFolder || !canStart || !isJobAvailable(type, availability),
      run: () => onRequestStart(type),
    };
  });
}

export interface SidecarSweepOptions {
  hasFolder: boolean;
  counts: Record<SidecarKind, number>;
  busy: boolean;
  onSweep: (kind: SidecarKind) => void;
}

export function buildSidecarSweepItems({
  hasFolder,
  counts,
  busy,
  onSweep,
}: SidecarSweepOptions): QuickActionItem[] {
  if (!hasFolder) return [];

  return SIDECAR_SWEEP_KINDS.map((kind) => ({
    id: `cmd:delete-${kind}-sidecars`,
    section: "commands",
    label: SIDECAR_SWEEP_COPY[kind].label,
    detail: sidecarSweepDetail(kind, counts[kind]),
    icon: SIDECAR_SWEEP_COPY[kind].icon,
    keywords: SIDECAR_SWEEP_COPY[kind].keywords,
    disabled: busy || counts[kind] === 0,
    run: () => onSweep(kind),
  }));
}

export interface SelectionCommandOptions {
  hasFolder: boolean;
  selectionMode: boolean;
  selectedCount: number;
  visibleCount: number;
  busy: boolean;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

function selectedCountDetail(count: number): string {
  if (count === 0) return "Nothing selected";
  return `${count} selected file${count === 1 ? "" : "s"}`;
}

export function buildSelectionCommandItems({
  hasFolder,
  selectionMode,
  selectedCount,
  visibleCount,
  busy,
  onSelectAll,
  onInvertSelection,
  onMove,
  onCopy,
  onDelete,
}: SelectionCommandOptions): QuickActionItem[] {
  if (!hasFolder) return [];

  const nothingVisible = visibleCount === 0;
  const allVisibleSelected = visibleCount > 0 && selectedCount === visibleCount;
  const canActOnSelection = selectedCount > 0 && !busy;
  const selectionDetail = selectedCountDetail(selectedCount);
  let invertDetail = "Swap selected and unselected in this view";
  if (!selectionMode) invertDetail = "Not in selection mode";
  else if (nothingVisible) invertDetail = "No files in this view";

  return [
    {
      id: "cmd:select-all",
      section: "commands",
      label: "Select all",
      detail: nothingVisible ? "No files in this view" : "Every file in this view",
      icon: iconListChecks,
      keywords: "selection everything",
      disabled: busy || nothingVisible || allVisibleSelected,
      run: onSelectAll,
    },
    {
      id: "cmd:invert-selection",
      section: "commands",
      label: "Invert selection",
      detail: invertDetail,
      icon: iconArrowLeftRight,
      keywords: "selection toggle flip opposite",
      disabled: busy || !selectionMode || nothingVisible,
      run: onInvertSelection,
    },
    {
      id: "cmd:move-selected",
      section: "commands",
      label: "Move selected files",
      detail: selectionDetail,
      icon: iconFolderInput,
      keywords: "selection transfer relocate",
      disabled: !canActOnSelection,
      run: onMove,
    },
    {
      id: "cmd:copy-selected",
      section: "commands",
      label: "Copy selected files",
      detail: selectionDetail,
      icon: iconCopy,
      keywords: "selection transfer duplicate",
      disabled: !canActOnSelection,
      run: onCopy,
    },
    {
      id: "cmd:delete-selected",
      section: "commands",
      label: "Delete selected files",
      detail: selectionDetail,
      icon: iconTrash2,
      keywords: "selection remove trash",
      disabled: !canActOnSelection,
      run: onDelete,
    },
  ];
}
