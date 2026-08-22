import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { ReplaceCaptionsSettings } from "@/features/automation/components/ReplaceCaptionsDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import type { VerifyCaptionsSettings } from "@/features/automation/preferences/verifyCaptionsPreferences";
import type { WatermarkSettings } from "@/features/automation/preferences/watermarkPreferences";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type {
  DuplicateThreshold,
  ReasoningEffort,
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSizeName,
} from "@/shared/types";

type FolderBusyDialogState<TConfirm> = {
  open: boolean;
  scope: DialogScopeInfo;
  busy?: boolean;
  onConfirm: TConfirm;
  onCancel: () => void;
};

export type AutomationDialogsState = {
  setCaptions: FolderBusyDialogState<(caption: string, overwrite: boolean) => void>;
  replaceCaptions: FolderBusyDialogState<(settings: ReplaceCaptionsSettings) => void> & {
    folderPath: string;
    selectedPaths?: string[];
  };
  backupCaptions: FolderBusyDialogState<(overwrite: boolean) => void>;
  autoCaption: FolderBusyDialogState<
    (
      mode: AutoCaptionMode,
      captionAudio: boolean,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
    ) => void
  >;
  verifyCaptions: FolderBusyDialogState<
    (
      mode: VerifyCaptionsMode,
      context: string,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
    ) => void
  > & {
    folderPath: string;
    initialSettings: VerifyCaptionsSettings | null;
  };
  findDuplicates: FolderBusyDialogState<(threshold: DuplicateThreshold) => void>;
  batchRename: FolderBusyDialogState<(stem: string, startNumber: number) => void>;
  trainLora: FolderBusyDialogState<(settings: TrainLoraSettings) => void>;
  watermark: FolderBusyDialogState<
    (
      text: string,
      size: WatermarkSizeName,
      opacity: WatermarkOpacity,
      position: WatermarkPosition,
    ) => void
  > & {
    initialSettings: WatermarkSettings | null;
  };
};
