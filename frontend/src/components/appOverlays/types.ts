import type { BodyPartsSettings } from "../../bodyPartsPreferences";
import type { ConfirmableJobType } from "../../constants/jobStartConfirm";
import type { AutoCaptionMode } from "../AutoCaptionDialog";
import type { VerifyCaptionsMode } from "../VerifyCaptionsDialog";
import type { CaptionSaveResponse, GalleryItem, SysPromptSaveResponse } from "../../types";

export type CaptionSavedHandler = (
  path: string,
  update: CaptionSaveResponse | SysPromptSaveResponse,
) => void;

export type FolderBusyDialogState<TConfirm> = {
  open: boolean;
  folderLabel: string;
  busy?: boolean;
  onConfirm: TConfirm;
  onCancel: () => void;
};

export type AutomationDialogsState = {
  setCaptions: FolderBusyDialogState<(caption: string, overwrite: boolean) => void>;
  bodyParts: FolderBusyDialogState<(settings: BodyPartsSettings) => void>;
  autoCaption: FolderBusyDialogState<(mode: AutoCaptionMode) => void>;
  verifyCaptions: FolderBusyDialogState<(mode: VerifyCaptionsMode, context: string) => void>;
  batchRename: FolderBusyDialogState<(stem: string) => void> & { itemCount: number };
};

export type GalleryOverlayState = {
  selectedPath: string | null;
  selectedIndex: number;
  modalItems: GalleryItem[];
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDeleted?: (path: string) => void;
  onJsonEditorOpenChange?: (open: boolean) => void;
};

export type IssueResolverOverlayState = {
  open: boolean;
  items: GalleryItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

export type SysPromptOverlayState = {
  open: boolean;
  item: GalleryItem | null;
  onClose: () => void;
};

export type JobStartConfirmState = {
  pending: ConfirmableJobType | null;
  folderLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export type FileImportOverlayState = {
  overwritePrompt: { conflicts: string[] } | null;
  busy: boolean;
  onReplaceExisting: () => void;
  onCopyNewOnly: () => void;
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
};
