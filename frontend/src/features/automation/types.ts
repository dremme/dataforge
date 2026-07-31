import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import type { VerifyCaptionsSettings } from "@/features/automation/preferences/verifyCaptionsPreferences";

type FolderBusyDialogState<TConfirm> = {
  open: boolean;
  folderLabel: string;
  busy?: boolean;
  onConfirm: TConfirm;
  onCancel: () => void;
};

export type AutomationDialogsState = {
  setCaptions: FolderBusyDialogState<(caption: string, overwrite: boolean) => void>;
  bodyParts: FolderBusyDialogState<(settings: BodyPartsSettings) => void> & {
    initialSettings: BodyPartsSettings | null;
  };
  autoCaption: FolderBusyDialogState<(mode: AutoCaptionMode) => void>;
  verifyCaptions: FolderBusyDialogState<(mode: VerifyCaptionsMode, context: string) => void> & {
    folderPath: string;
    initialSettings: VerifyCaptionsSettings | null;
  };
  batchRename: FolderBusyDialogState<(stem: string) => void> & { itemCount: number };
  trainLora: FolderBusyDialogState<(settings: TrainLoraSettings) => void> & { itemCount: number };
};
