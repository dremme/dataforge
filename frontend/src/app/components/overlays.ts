import type { AutomationDialogsState } from "@/features/automation";
import type { ConfirmableJobType } from "@/features/jobs";
import type { CaptionSaveResponse, GalleryItem, SysPromptSaveResponse } from "@/shared/types";

type CaptionSavedHandler = (
  path: string,
  update: CaptionSaveResponse | SysPromptSaveResponse,
) => void;

type GalleryOverlayState = {
  selectedPath: string | null;
  selectedIndex: number;
  modalItems: GalleryItem[];
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDeleted?: (path: string) => void;
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

export type AppOverlaysProps = {
  currentFolder: string | undefined;
  onOpenFolder: (path?: string) => void;
  onCaptionSaved: CaptionSavedHandler;
  gallery: GalleryOverlayState;
  issueResolver: IssueResolverOverlayState;
  sysprompt: SysPromptOverlayState;
  jobStart: JobStartConfirmState;
  automation: AutomationDialogsState;
  fileImport: FileImportOverlayState;
  createFolder: CreateFolderOverlayState | null;
};
