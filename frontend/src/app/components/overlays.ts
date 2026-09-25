import type { InstructionKind } from "@/shared/api/folderInstructions";
import type { AutomationDialogsState } from "@/features/automation/types";
import type { ConfirmableJobType } from "@/features/jobs/lib/jobMeta";
import type { SelectionActionOverlaysProps } from "@/features/gallery/components/SelectionActionOverlays";
import type { SidecarSweepOverlayProps } from "@/features/gallery/components/SidecarSweepOverlay";
import type { AcceptAllCandidatesDialogProps } from "@/features/gallery/components/AcceptAllCandidatesDialog";
import type { CandidateReviewEntry } from "@/features/gallery/lib/candidateReview";
import type { QuickActionOverlayState } from "@/features/quickAction/hooks/useQuickActionHost";
import type {
  CaptionSaveResponse,
  DuplicateGroup,
  GalleryItem,
  InstructionFileResponse,
} from "@/shared/types";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

type CaptionSavedHandler = (path: string, update: CaptionSaveResponse) => void;

type GalleryOverlayState = {
  selectedPath: string | null;
  selectedIndex: number;
  modalItems: GalleryItem[];
  searchQuery: string;
  searchRegex: boolean;
  hasCaptionBackup: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDeleted?: (path: string) => void;
  onMoved?: (paths: string[]) => void | Promise<void>;
  onCopied?: () => void | Promise<void>;
  onResolveIssue?: (item: GalleryItem) => void;
  onReviewCandidate?: (item: GalleryItem) => void;
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
  tab: InstructionKind;
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
  onResolved: () => void;
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
  acceptAllCandidates: AcceptAllCandidatesDialogProps;
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
};
