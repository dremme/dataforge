import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { ReplaceCaptionsSettings } from "@/features/automation/components/ReplaceCaptionsDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type {
  DuplicateThreshold,
  ReasoningEffort,
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSizeName,
} from "@/shared/types";

/**
 * Every job dialog carries the settings its last run was started with, so all nine
 * open the same way: `null` until this folder's preferences have loaded.
 */
type FolderBusyDialogState<TConfirm, TSettings> = {
  open: boolean;
  scope: DialogScopeInfo;
  initialSettings: TSettings | null;
  busy?: boolean;
  onConfirm: TConfirm;
  onCancel: () => void;
};

export type AutomationDialogsState = {
  setCaptions: FolderBusyDialogState<
    (caption: string, overwrite: boolean) => void,
    JobSettingsByType["set_captions"]
  >;
  replaceCaptions: FolderBusyDialogState<
    (settings: ReplaceCaptionsSettings) => void,
    JobSettingsByType["replace_captions"]
  > & {
    folderPath: string;
    selectedPaths?: string[];
  };
  backupCaptions: FolderBusyDialogState<
    (overwrite: boolean) => void,
    JobSettingsByType["backup_captions"]
  >;
  autoCaption: FolderBusyDialogState<
    (
      mode: AutoCaptionMode,
      captionAudio: boolean,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
    ) => void,
    JobSettingsByType["auto_caption"]
  >;
  verifyCaptions: FolderBusyDialogState<
    (
      mode: VerifyCaptionsMode,
      context: string,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
    ) => void,
    JobSettingsByType["verify_captions"]
  >;
  findDuplicates: FolderBusyDialogState<
    (threshold: DuplicateThreshold) => void,
    JobSettingsByType["find_duplicates"]
  >;
  batchRename: FolderBusyDialogState<
    (stem: string, startNumber: number) => void,
    JobSettingsByType["batch_rename"]
  >;
  trainLora: FolderBusyDialogState<
    (settings: TrainLoraSettings) => void,
    JobSettingsByType["train_lora"]
  >;
  watermark: FolderBusyDialogState<
    (
      text: string,
      size: WatermarkSizeName,
      opacity: WatermarkOpacity,
      position: WatermarkPosition,
    ) => void,
    JobSettingsByType["watermark"]
  >;
};
