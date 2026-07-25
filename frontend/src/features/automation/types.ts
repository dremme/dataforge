import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";

type FolderBusyDialogState<TConfirm> = {
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
