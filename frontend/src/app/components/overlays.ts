import type { AutomationDialogsState } from "@/features/automation/types";
import type { ConfirmableJobType } from "@/features/jobs/lib/jobMeta";
import type { SelectionActionOverlaysProps } from "@/features/gallery/components/SelectionActionOverlays";
import type { SidecarSweepOverlayProps } from "@/features/gallery/components/SidecarSweepOverlay";
import type { QuickActionOverlayState } from "@/features/quickAction/hooks/useQuickActionHost";
import type {
  CaptionSaveResponse,
  DuplicateGroup,
  GalleryItem,
  SysPromptSaveResponse,
} from "@/shared/types";

type CaptionSavedHandler = (
  path: string,
  update: CaptionSaveResponse | SysPromptSaveResponse,
) => void;

type GalleryOverlayState = {
  selectedPath: string | null;
  selectedIndex: number;
  modalItems: GalleryItem[];
  searchQuery: string;
  searchRegex: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDeleted?: (path: string) => void;
  onMoved?: (paths: string[]) => void | Promise<void>;
  onCopied?: () => void | Promise<void>;
  onResolveIssue?: (item: GalleryItem) => void;
  onJsonEditorOpenChange?: (open: boolean) => void;
};

type IssueResolverOverlayState = {
  open: boolean;
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

type SysPromptOverlayState = {
  open: boolean;
  item: GalleryItem | null;
  onClose: () => void;
};

type DuplicateResolverOverlayState = {
  open: boolean;
  groups: DuplicateGroup[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  /** False where a delete is permanent, which is what earns the extra confirmation. */
  deletesToTrash: boolean;
  onResolved: () => void;
};

type StatsOverlayState = {
  open: boolean;
  /** The whole folder: the dataset overview ignores the search and filters. */
  items: GalleryItem[];
  onClose: () => void;
};

type JobStartConfirmState = {
  pending: ConfirmableJobType | null;
  folderLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

type FileImportOverlayState = {
  overwritePrompt: { conflicts: string[] } | null;
  busy: boolean;
  onReplaceExisting: () => void;
  onCopyNewOnly: () => void;
  onCancel: () => void;
};

type CreateFolderOverlayState = {
  parentLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

type FolderPickerOverlayState = {
  open: boolean;
  openPicker: () => void;
  closePicker: () => void;
};

export type AppOverlaysProps = {
  currentFolder: string | undefined;
  onOpenFolder: (path?: string) => void;
  folderPicker: FolderPickerOverlayState;
  quickAction: QuickActionOverlayState;
  selectionActions: SelectionActionOverlaysProps;
  sidecarSweep: SidecarSweepOverlayProps;
  onCaptionSaved: CaptionSavedHandler;
  gallery: GalleryOverlayState;
  issueResolver: IssueResolverOverlayState;
  sysprompt: SysPromptOverlayState;
  stats: StatsOverlayState;
  duplicateResolver: DuplicateResolverOverlayState;
  jobStart: JobStartConfirmState;
  automation: AutomationDialogsState;
  fileImport: FileImportOverlayState;
  createFolder: CreateFolderOverlayState | null;
};
