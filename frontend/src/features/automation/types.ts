import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionModal";
import type { ComfyProcessSettings } from "@/features/automation/components/ComfyProcessModal";
import type { ReplaceCaptionsSettings } from "@/features/automation/components/ReplaceCaptionsModal";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsModal";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import type {
  AutomationMode,
  DuplicateThreshold,
  ReasoningEffort,
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSizeName,
} from "@/shared/types";

type FolderBusyModalState<TConfirm, TSettings> = {
  open: boolean;
  scope: ModalScopeInfo;
  initialSettings: TSettings | null;
  busy?: boolean;
  onConfirm: TConfirm;
  onCancel: () => void;
};

export type AutomationModalsState = {
  setCaptions: FolderBusyModalState<
    (caption: string, overwrite: boolean) => void,
    JobSettingsByType["set_captions"]
  >;
  replaceCaptions: FolderBusyModalState<
    (settings: ReplaceCaptionsSettings) => void,
    JobSettingsByType["replace_captions"]
  > & {
    folderPath: string;
    selectedPaths?: string[];
  };
  backupCaptions: FolderBusyModalState<() => void, JobSettingsByType["backup_captions"]>;
  autoCaption: FolderBusyModalState<
    (
      mode: AutoCaptionMode,
      captionAudio: boolean,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
    ) => void,
    JobSettingsByType["auto_caption"]
  > & {
    folderPath: string;
  };
  verifyCaptions: FolderBusyModalState<
    (
      mode: VerifyCaptionsMode,
      context: string,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
    ) => void,
    JobSettingsByType["verify_captions"]
  >;
  editCaptions: FolderBusyModalState<
    (
      mode: AutomationMode,
      instruction: string,
      reasoningEffort: ReasoningEffort,
      preserveThinking: boolean,
      backup: boolean,
    ) => void,
    JobSettingsByType["edit_captions"]
  > & {
    folderPath: string;
    selectedPaths?: string[];
  };
  findDuplicates: FolderBusyModalState<
    (threshold: DuplicateThreshold) => void,
    JobSettingsByType["find_duplicates"]
  >;
  batchRename: FolderBusyModalState<
    (stem: string, startNumber: number) => void,
    JobSettingsByType["batch_rename"]
  >;
  trainLora: FolderBusyModalState<
    (settings: TrainLoraSettings) => void,
    JobSettingsByType["train_lora"]
  >;
  watermark: FolderBusyModalState<
    (
      text: string,
      size: WatermarkSizeName,
      opacity: WatermarkOpacity,
      position: WatermarkPosition,
      stripMetadata: boolean,
    ) => void,
    JobSettingsByType["watermark"]
  >;
  comfyProcess: FolderBusyModalState<
    (settings: ComfyProcessSettings) => void,
    JobSettingsByType["comfy_process"]
  >;
  resize: FolderBusyModalState<
    (megapixels: number, multiple: number, resetSize: boolean) => void,
    JobSettingsByType["resize"]
  >;
  autoAdjust: {
    open: boolean;
    scope: ModalScopeInfo;
    busy: boolean;
    onConfirm: (replaceAdjustments: boolean, resetAdjustments: boolean) => void;
    onCancel: () => void;
  };
  checkCaptionRules: {
    open: boolean;
    scope: ModalScopeInfo;
    busy: boolean;
    folderPath: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
};
