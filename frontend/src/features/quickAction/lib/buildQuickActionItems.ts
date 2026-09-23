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
  jobTypeLabelFor,
  type JobAvailability,
} from "@/features/jobs/lib/jobMeta";
import { candidateCountPhrase } from "@/features/gallery/lib/acceptAllCandidates";
import { SIDECAR_SWEEP_KINDS, sidecarCountPhrase } from "@/features/gallery/lib/sidecarSweep";
import {
  FILE_FILTER_OPTIONS,
  FILTER_AXIS_LABELS,
  FILTER_OPTIONS,
  MEDIA_TYPE_FILTER_OPTIONS,
} from "@/features/gallery/lib/filters";
import type { FileFilter, ItemFilter, MediaTypeFilter } from "@/features/gallery/lib/query";
import {
  iconArrowLeftRight,
  iconArrowUp,
  iconArrowUpRight,
  iconBrain,
  iconCode,
  iconCopy,
  iconFiles,
  iconFolder,
  iconFilter,
  iconFilterX,
  iconFolderInput,
  iconFolderOpen,
  iconFolderPlus,
  iconHome,
  iconListChecks,
  iconMessageWarning,
  iconRefresh,
  iconScanSquare,
  iconStar,
  iconTrash2,
  type AppIcon,
} from "@/shared/icons";
import type {
  ExternalOstrisJob,
  FolderFavorite,
  FolderResponse,
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

/**
 * A job row navigates to its folder, so it shares the folder id: `orderQuickActionItems` then
 * collapses a folder's job history to its newest run and yields to a plainer row for that folder.
 *
 * No keywords: the row shows the folder's leaf name, so matching it on the full path (or on an
 * external run's name) put rows on screen with nothing to highlight and no reason to be there.
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
      id: quickActionFolderId(job.dataset_folder),
      section: "jobs",
      label: job.dataset_folder_name || folderLeafName(job.dataset_folder),
      detail: `${jobTypeLabelFor("train_lora")} · ${job.status}`,
      icon: iconBrain,
      run: () => onNavigate(job.dataset_folder),
    }));

  const localItems = jobs
    .filter((job) => !isTrainLoraCoTrackedByExternal(job, externalJobs))
    .map<QuickActionItem>((job) => ({
      id: quickActionFolderId(job.folder),
      section: "jobs",
      label: job.folder_name || folderLeafName(job.folder),
      detail: `${jobTypeLabel(job)} · ${statusLabel(job)}`,
      icon: jobIcon(job),
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
      menuLabel?: string;
      menuDescription?: string;
    };

    return {
      id: quickActionRunJobId(type),
      section: "run",
      label: meta.menuLabel ?? jobTypeLabelFor(type),
      detail: meta.menuDescription,
      icon: jobTypeIconFor(type),
      keywords: jobTypeLabelFor(type),
      disabled: !hasFolder || !canStart || !isJobAvailable(type, availability),
      run: () => onRequestStart(type),
    };
  });
}

export interface NavigationCommandOptions {
  parentPath: string | null;
  atHome: boolean;
  onOpenFolderPicker: () => void;
  onGoHome: () => void;
  onNavigate: (path: string) => void;
}

export function buildNavigationCommandItems({
  parentPath,
  atHome,
  onOpenFolderPicker,
  onGoHome,
  onNavigate,
}: NavigationCommandOptions): QuickActionItem[] {
  return [
    {
      id: "cmd:open-folder",
      section: "commands",
      label: "Open folder...",
      detail: "Pick a folder by path, favorite or recent",
      icon: iconFolderOpen,
      keywords: "browse path picker navigate jump switch go to directory",
      run: onOpenFolderPicker,
    },
    {
      id: "cmd:home-folder",
      section: "commands",
      label: "Home",
      detail: "Go to your home folder",
      icon: iconHome,
      keywords: "root start base top go home",
      disabled: atHome,
      run: onGoHome,
    },
    {
      id: "cmd:parent-folder",
      section: "commands",
      label: "Go to parent folder",
      detail: parentPath ?? "No parent folder",
      icon: iconArrowUp,
      keywords: "up back level higher directory",
      disabled: !parentPath,
      run: () => {
        if (parentPath) onNavigate(parentPath);
      },
    },
  ];
}

export interface FolderCommandOptions {
  folderFound: boolean;
  onCreateFolder: () => void;
  onRefresh: () => void;
}

export function buildFolderCommandItems({
  folderFound,
  onCreateFolder,
  onRefresh,
}: FolderCommandOptions): QuickActionItem[] {
  const refresh: QuickActionItem = {
    id: "cmd:refresh-folder",
    section: "commands",
    label: "Refresh folder",
    detail: "Reload this folder from disk",
    icon: iconRefresh,
    keywords: "reload rescan sync update reread disk",
    run: onRefresh,
  };

  if (!folderFound) return [refresh];

  return [
    {
      id: "cmd:new-folder",
      section: "commands",
      label: "New folder",
      detail: "Create a subfolder here",
      icon: iconFolderPlus,
      keywords: "create make add mkdir directory subfolder",
      run: onCreateFolder,
    },
    refresh,
  ];
}

/** A row appears only while its callback is set; the panel sets one only when there is work. */
export interface ReviewCommandOptions {
  issueCount: number;
  onResolveIssues?: () => void;
  duplicateGroupCount: number;
  onResolveDuplicates?: () => void;
  candidateCount: number;
  onReviewCandidates?: () => void;
}

export function buildReviewCommandItems({
  issueCount,
  onResolveIssues,
  duplicateGroupCount,
  onResolveDuplicates,
  candidateCount,
  onReviewCandidates,
}: ReviewCommandOptions): QuickActionItem[] {
  const items: QuickActionItem[] = [];

  if (onResolveIssues) {
    items.push({
      id: "cmd:resolve-issues",
      section: "commands",
      label: "Resolve caption issues",
      detail: `${issueCount} flagged`,
      icon: iconMessageWarning,
      keywords: "fix captions problems flagged findings warnings verify review",
      run: onResolveIssues,
    });
  }

  if (onResolveDuplicates) {
    items.push({
      id: "cmd:resolve-duplicates",
      section: "commands",
      label: "Resolve duplicates",
      detail: `${duplicateGroupCount} group${duplicateGroupCount === 1 ? "" : "s"}`,
      icon: iconFiles,
      keywords: "dedupe near identical similar copies clones compare review",
      run: onResolveDuplicates,
    });
  }

  if (onReviewCandidates) {
    items.push({
      id: "cmd:review-candidates",
      section: "commands",
      label: "Review candidates",
      detail: `${candidateCount} waiting`,
      icon: iconScanSquare,
      keywords:
        "comfyui upscale upscaled staging staged accept reject approve compare before after side by side",
      run: onReviewCandidates,
    });
  }

  return items;
}

const SIDECAR_SWEEP_COMMANDS: Record<
  SidecarKind,
  { label: string; icon: AppIcon; keywords: string }
> = {
  issue: {
    label: "Delete all .issue.json files",
    icon: iconMessageWarning,
    keywords:
      "sidecar caption issues verify findings flags warnings clear remove sweep cleanup purge",
  },
  duplicate: {
    label: "Delete all .duplicate.json files",
    icon: iconFiles,
    keywords: "sidecar duplicates dedupe findings flags clear remove sweep cleanup purge",
  },
};

function sidecarSweepDetail(kind: SidecarKind, count: number): string {
  if (count === 0) return "Nothing to delete";
  return sidecarCountPhrase(kind, count);
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
    label: SIDECAR_SWEEP_COMMANDS[kind].label,
    detail: sidecarSweepDetail(kind, counts[kind]),
    icon: SIDECAR_SWEEP_COMMANDS[kind].icon,
    keywords: SIDECAR_SWEEP_COMMANDS[kind].keywords,
    disabled: busy || counts[kind] === 0,
    run: () => onSweep(kind),
  }));
}

export interface AcceptAllCandidatesOptions {
  hasFolder: boolean;
  count: number;
  fromSelection: boolean;
  busy: boolean;
  onAccept: () => void;
}

function acceptAllCandidatesDetail(count: number, fromSelection: boolean): string {
  if (fromSelection) {
    return count === 0
      ? "No candidates in the selection"
      : `${candidateCountPhrase(count)} in the selection`;
  }
  if (count === 0) return "No candidates waiting";
  return `${candidateCountPhrase(count)} waiting`;
}

export function buildAcceptAllCandidatesItems({
  hasFolder,
  count,
  fromSelection,
  busy,
  onAccept,
}: AcceptAllCandidatesOptions): QuickActionItem[] {
  if (!hasFolder) return [];

  return [
    {
      id: "cmd:accept-all-candidates",
      section: "commands",
      label: fromSelection ? "Accept selected candidates" : "Accept all staged candidates",
      detail: acceptAllCandidatesDetail(count, fromSelection),
      icon: iconScanSquare,
      keywords:
        "comfyui upscale upscaled staging staged approve apply keep publish replace bulk batch",
      disabled: busy || count === 0,
      run: onAccept,
    },
  ];
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
      keywords: "selection everything check mark ctrl+a",
      disabled: busy || nothingVisible || allVisibleSelected,
      run: onSelectAll,
    },
    {
      id: "cmd:invert-selection",
      section: "commands",
      label: "Invert selection",
      detail: invertDetail,
      icon: iconArrowLeftRight,
      keywords: "selection toggle flip opposite reverse swap",
      disabled: busy || !selectionMode || nothingVisible,
      run: onInvertSelection,
    },
    {
      id: "cmd:move-selected",
      section: "commands",
      label: "Move selected files",
      detail: selectionDetail,
      icon: iconFolderInput,
      keywords: "selection transfer relocate cut send",
      disabled: !canActOnSelection,
      run: onMove,
    },
    {
      id: "cmd:copy-selected",
      section: "commands",
      label: "Copy selected files",
      detail: selectionDetail,
      icon: iconCopy,
      keywords: "selection transfer duplicate clone send",
      disabled: !canActOnSelection,
      run: onCopy,
    },
    {
      id: "cmd:delete-selected",
      section: "commands",
      label: "Delete selected files",
      detail: selectionDetail,
      icon: iconTrash2,
      keywords: "selection remove erase discard trash recycle bin",
      disabled: !canActOnSelection,
      run: onDelete,
    },
  ];
}

export function buildSyspromptCommandItem(onEditSysprompt: () => void): QuickActionItem {
  return {
    id: "cmd:edit-sysprompt",
    section: "commands",
    label: "Edit system prompt",
    detail: "The captioning instructions for this folder",
    icon: iconCode,
    keywords: "sysprompt instructions captioning rules guidelines template",
    run: onEditSysprompt,
  };
}

export interface FolderPathCommandOptions {
  folderPath: string;
  onCopyPath: (path: string) => void;
  onRevealInExplorer: (path: string) => void;
}

export function buildFolderPathCommandItems({
  folderPath,
  onCopyPath,
  onRevealInExplorer,
}: FolderPathCommandOptions): QuickActionItem[] {
  return [
    {
      id: "cmd:copy-path",
      section: "commands",
      label: "Copy folder path",
      detail: folderPath,
      icon: iconCopy,
      keywords: "clipboard location directory address",
      run: () => onCopyPath(folderPath),
    },
    {
      id: "cmd:open-in-explorer",
      section: "commands",
      label: "Open in File Explorer",
      detail: folderPath,
      icon: iconArrowUpRight,
      keywords: "reveal show windows finder file manager browse disk",
      run: () => onRevealInExplorer(folderPath),
    },
  ];
}

export interface CommandOptions {
  folder: Pick<FolderResponse, "path" | "home" | "parent"> | null;
  /** False once the open folder has gone missing on disk. */
  folderFound: boolean;
  onOpenFolderPicker: () => void;
  onGoHome: () => void;
  onNavigate: (path: string) => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
  onCopyPath: (path: string) => void;
  onRevealInExplorer: (path: string) => void;
  onEditSysprompt: () => void;
  review: ReviewCommandOptions;
  acceptAllCandidates: Omit<AcceptAllCandidatesOptions, "hasFolder">;
  sidecarSweep: Omit<SidecarSweepOptions, "hasFolder">;
  selection: Omit<SelectionCommandOptions, "hasFolder">;
}

/** Every command row, in palette order. */
export function buildCommandItems({
  folder,
  folderFound,
  onOpenFolderPicker,
  onGoHome,
  onNavigate,
  onCreateFolder,
  onRefresh,
  onCopyPath,
  onRevealInExplorer,
  onEditSysprompt,
  review,
  acceptAllCandidates,
  sidecarSweep,
  selection,
}: CommandOptions): QuickActionItem[] {
  const navigation = buildNavigationCommandItems({
    parentPath: folder?.parent ?? null,
    atHome: Boolean(folder && folderFound && folderPathsEqual(folder.path, folder.home)),
    onOpenFolderPicker,
    onGoHome,
    onNavigate,
  });

  if (!folder) return navigation;

  return [
    ...navigation,
    ...buildFolderCommandItems({ folderFound, onCreateFolder, onRefresh }),
    ...buildReviewCommandItems(review),
    ...buildAcceptAllCandidatesItems({ ...acceptAllCandidates, hasFolder: folderFound }),
    ...buildSidecarSweepItems({ ...sidecarSweep, hasFolder: folderFound }),
    ...buildSelectionCommandItems({ ...selection, hasFolder: folderFound }),
    buildSyspromptCommandItem(onEditSysprompt),
    ...(folderFound
      ? buildFolderPathCommandItems({ folderPath: folder.path, onCopyPath, onRevealInExplorer })
      : []),
  ];
}

type FilterAxis = keyof typeof FILTER_AXIS_LABELS;

interface FilterOption<T extends string> {
  value: T;
  label: string;
  ariaLabel: string;
}

export interface FilterCommandOptions {
  hasFolder: boolean;
  hasActiveFilters: boolean;
  mediaType: MediaTypeFilter;
  caption: ItemFilter;
  file: FileFilter;
  counts: {
    mediaType: Readonly<Record<MediaTypeFilter, number>>;
    caption: Readonly<Record<ItemFilter, number>>;
    file: Readonly<Record<FileFilter, number>>;
  };
  onSelectMediaType: (value: MediaTypeFilter) => void;
  onSelectCaption: (value: ItemFilter) => void;
  onSelectFile: (value: FileFilter) => void;
  onReset: () => void;
}

/**
 * One row per option the filter menu offers, minus each axis's "all" entry: picking "all"
 * is what Reset does.
 */
function filterAxisItems<T extends string>(
  axis: FilterAxis,
  options: ReadonlyArray<FilterOption<T>>,
  active: T,
  counts: Readonly<Record<T, number>>,
  onSelect: (value: T) => void,
): QuickActionItem[] {
  const axisLabel = FILTER_AXIS_LABELS[axis];

  return options
    .filter((option) => option.value !== "all")
    .map((option) => {
      const isActive = option.value === active;
      const count = counts[option.value];

      return {
        id: `filter:${axis}:${option.value}`,
        section: "filters",
        label: option.ariaLabel,
        detail: isActive
          ? `${axisLabel} · already active`
          : `${axisLabel} · ${count} file${count === 1 ? "" : "s"}`,
        icon: iconFilter,
        keywords: `filter show only hide others ${option.label}`,
        disabled: isActive,
        run: () => onSelect(option.value),
      };
    });
}

export function buildFilterItems({
  hasFolder,
  hasActiveFilters,
  mediaType,
  caption,
  file,
  counts,
  onSelectMediaType,
  onSelectCaption,
  onSelectFile,
  onReset,
}: FilterCommandOptions): QuickActionItem[] {
  if (!hasFolder) return [];

  return [
    ...filterAxisItems(
      "mediaType",
      MEDIA_TYPE_FILTER_OPTIONS,
      mediaType,
      counts.mediaType,
      onSelectMediaType,
    ),
    ...filterAxisItems("caption", FILTER_OPTIONS, caption, counts.caption, onSelectCaption),
    ...filterAxisItems("file", FILE_FILTER_OPTIONS, file, counts.file, onSelectFile),
    {
      id: "filter:reset",
      section: "filters",
      label: "Reset all filters",
      // Search is separate state with its own clear button, so it is not swept up here.
      detail: hasActiveFilters ? "Back to all media, captions and files" : "No filters active",
      icon: iconFilterX,
      keywords: "clear remove unfilter show everything all files",
      disabled: !hasActiveFilters,
      run: onReset,
    },
  ];
}
