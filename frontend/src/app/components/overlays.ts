import type { InstructionKind } from "@/shared/api/folderInstructions";
import type { AutomationDialogsState } from "@/features/automation/types";
import type { GalleryItemOpenIntent } from "@/features/gallery/hooks/useGalleryOverlays";
import type { ConfirmableJobType } from "@/features/jobs/lib/jobMeta";
import type { SelectionActionOverlaysProps } from "@/features/gallery/components/SelectionActionOverlays";
import type { SidecarSweepDialogProps } from "@/features/gallery/components/SidecarSweepDialog";
import type { DeleteFolderOverlayState } from "@/features/folder/hooks/useDeleteFolderDialog";
import type { RenameFolderOverlayState } from "@/features/folder/hooks/useRenameFolderDialog";
import type { SettleAllCandidatesDialogProps } from "@/features/gallery/components/SettleAllCandidatesDialog";
import type { CandidateReviewEntry } from "@/features/gallery/lib/candidateReview";
import type { QuickActionOverlayState } from "@/features/quickAction/hooks/useQuickActionHost";
import type {
  CaptionSaveResponse,
  DuplicateGroup,
  GalleryItem,
  InstructionFileResponse,
} from "@/shared/types";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type { RefObject } from "react";
import type { WorkspaceTransition } from "@/app/hooks/useWorkspaceTransitions";
import type { CurrentJobActions } from "@/features/jobs/components/JobsDialog";

type CaptionSavedHandler = (path: string, update: CaptionSaveResponse) => void;

type GalleryOverlayState = {
  selectedPath: string | null;
  selectedIndex: number;
  dialogItems: GalleryItem[];
  openIntent: GalleryItemOpenIntent | null;
  searchQuery: string;
  searchRegex: boolean;
  hasCaptionBackup: boolean;
  focusView?: boolean;
  onFocusViewChange?: (focus: boolean) => void;
  onEditExpandedChange?: (expanded: boolean) => void;
  transitionRef?: RefObject<WorkspaceTransition | null>;
  /** The video editor covers the viewer; its keys and focus trap must stay off meanwhile. */
  suspended?: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onGoTo: (index: number) => void;
  onDeleted?: (path: string) => void;
  onRenamed?: (path: string, renamedPath: string) => void;
  onMoved?: (paths: string[]) => void | Promise<void>;
  onCopied?: () => void | Promise<void>;
  onResolveIssue?: (item: GalleryItem) => void;
  onReviewCandidate?: (item: GalleryItem) => void;
  onResolveDuplicate?: (item: GalleryItem) => void;
};

type IssueResolverOverlayState = {
  open: boolean;
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

type InstructionsOverlayState = {
  open: boolean;
  folderPath: string | undefined;
  onClose: () => void;
  onSaved: (kind: InstructionKind, saved: InstructionFileResponse) => void;
};

type DuplicateResolverOverlayState = {
  open: boolean;
  groups: DuplicateGroup[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  deletesToTrash: boolean;
  onResolved: (deletedPaths: string[]) => void;
};

type CandidateReviewOverlayState = {
  open: boolean;
  entries: CandidateReviewEntry[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onResolved: () => void;
};

type StatsOverlayState = {
  open: boolean;
  items: GalleryItem[];
  onClose: () => void;
  onSearchWord: (word: string) => void;
};

type JobStartConfirmState = {
  pending: ConfirmableJobType | null;
  scope: DialogScopeInfo;
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

type RenameFileOverlayState = {
  fileName: string;
  busy: boolean;
  error: string | null;
  onConfirm: (name: string) => Promise<void>;
  onCancel: () => void;
};

type SettingsOverlayState = {
  open: boolean;
  onClose: () => void;
};

type ShortcutsOverlayState = {
  open: boolean;
  onClose: () => void;
};

export type AppOverlaysProps = {
  currentJobActions?: Partial<CurrentJobActions>;
  currentFolder: string | undefined;
  onOpenFolder: (path?: string) => void;
  quickAction: QuickActionOverlayState;
  selectionActions: SelectionActionOverlaysProps;
  renameFile: RenameFileOverlayState | null;
  sidecarSweep: SidecarSweepDialogProps;
  settleAllCandidates: SettleAllCandidatesDialogProps;
  onCaptionSaved: CaptionSavedHandler;
  gallery: GalleryOverlayState;
  issueResolver: IssueResolverOverlayState;
  instructions: InstructionsOverlayState;
  stats: StatsOverlayState;
  duplicateResolver: DuplicateResolverOverlayState;
  candidateReview: CandidateReviewOverlayState;
  jobStart: JobStartConfirmState;
  automation: AutomationDialogsState;
  fileImport: FileImportOverlayState;
  createFolder: CreateFolderOverlayState | null;
  renameFolder: RenameFolderOverlayState | null;
  deleteFolder: DeleteFolderOverlayState | null;
  settings: SettingsOverlayState;
  shortcuts: ShortcutsOverlayState;
};
