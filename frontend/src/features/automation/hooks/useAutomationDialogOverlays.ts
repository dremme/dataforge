import { useCallback, useMemo, useState } from "react";
import { trainLoraBody, type TrainLoraSettings } from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import {
  loadVerifyCaptionsSettings,
  type VerifyCaptionsSettings,
} from "@/features/automation/preferences/verifyCaptionsPreferences";
import {
  loadWatermarkSettings,
  type WatermarkSettings,
} from "@/features/automation/preferences/watermarkPreferences";
import type { AutomationDialogsState } from "@/features/automation/types";
import type { JobStartBodies, JobStartBody } from "@/shared/api/jobStartBodies";
import type {
  JobType,
  ReasoningEffort,
  WatermarkOpacity,
  WatermarkPosition,
  WatermarkSizeName,
} from "@/shared/types";

type UseAutomationDialogOverlaysOptions = {
  folderPath: string | undefined;
  folderLabel: string;
  startingJobType: JobType | null;
  itemCount: number;
  startJob: (
    jobType: JobType,
    folder: string,
    body?: JobStartBody,
    paths?: string[],
  ) => Promise<unknown>;
  getJobPaths?: () => string[] | undefined;
};

export function useAutomationDialogOverlays({
  folderPath,
  folderLabel,
  startingJobType,
  itemCount,
  startJob,
  getJobPaths,
}: UseAutomationDialogOverlaysOptions) {
  // At most one dialog is ever open, so one job type beats a boolean per dialog.
  const [openJobType, setOpenJobType] = useState<JobType | null>(null);
  const [verifyCaptionsSettings, setVerifyCaptionsSettings] =
    useState<VerifyCaptionsSettings | null>(null);
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettings | null>(null);

  const closeDialog = useCallback(() => {
    setOpenJobType(null);
    setVerifyCaptionsSettings(null);
    setWatermarkSettings(null);
  }, []);

  /** Closes the dialog, then starts its job; a rejection is already reported by the context. */
  const startJobFromDialog = useCallback(
    <T extends JobType>(jobType: T, body?: JobStartBodies[T]) => {
      if (!folderPath) return;
      closeDialog();
      startJob(jobType, folderPath, body, getJobPaths?.()).catch(() => {});
    },
    [closeDialog, folderPath, getJobPaths, startJob],
  );

  const openVerifyCaptionsDialog = useCallback(async () => {
    if (!folderPath) return;
    const settings = await loadVerifyCaptionsSettings(folderPath);
    setVerifyCaptionsSettings(settings);
    setOpenJobType("verify_captions");
  }, [folderPath]);

  const openWatermarkDialog = useCallback(async () => {
    setWatermarkSettings(await loadWatermarkSettings());
    setOpenJobType("watermark");
  }, []);

  const dialogs = useMemo<AutomationDialogsState>(() => {
    const shared = (jobType: JobType) => ({
      open: openJobType === jobType,
      folderLabel,
      busy: startingJobType === jobType,
      onCancel: closeDialog,
    });

    return {
      setCaptions: {
        ...shared("set_captions"),
        onConfirm: (caption: string, overwrite: boolean) =>
          startJobFromDialog("set_captions", { caption, overwrite }),
      },
      backupCaptions: {
        ...shared("backup_captions"),
        onConfirm: (overwrite: boolean) => startJobFromDialog("backup_captions", { overwrite }),
      },
      autoCaption: {
        ...shared("auto_caption"),
        onConfirm: (
          mode: AutoCaptionMode,
          captionAudio: boolean,
          reasoningEffort: ReasoningEffort,
          preserveThinking: boolean,
        ) =>
          startJobFromDialog("auto_caption", {
            mode,
            caption_audio: captionAudio,
            reasoning_effort: reasoningEffort,
            preserve_thinking: preserveThinking,
          }),
      },
      verifyCaptions: {
        ...shared("verify_captions"),
        folderPath: folderPath ?? "",
        initialSettings: verifyCaptionsSettings,
        onConfirm: (
          mode: VerifyCaptionsMode,
          context: string,
          reasoningEffort: ReasoningEffort,
          preserveThinking: boolean,
        ) =>
          startJobFromDialog("verify_captions", {
            mode,
            context,
            reasoning_effort: reasoningEffort,
            preserve_thinking: preserveThinking,
          }),
      },
      batchRename: {
        ...shared("batch_rename"),
        itemCount,
        onConfirm: (stem: string) => startJobFromDialog("batch_rename", { stem }),
      },
      trainLora: {
        ...shared("train_lora"),
        itemCount,
        onConfirm: (settings: TrainLoraSettings) =>
          startJobFromDialog("train_lora", trainLoraBody(settings)),
      },
      watermark: {
        ...shared("watermark"),
        itemCount,
        initialSettings: watermarkSettings,
        onConfirm: (
          text: string,
          size: WatermarkSizeName,
          opacity: WatermarkOpacity,
          position: WatermarkPosition,
        ) => startJobFromDialog("watermark", { text, size, opacity, position }),
      },
    };
  }, [
    closeDialog,
    folderLabel,
    folderPath,
    itemCount,
    openJobType,
    startJobFromDialog,
    startingJobType,
    verifyCaptionsSettings,
    watermarkSettings,
  ]);

  /** Shows a job type's dialog, loading its saved settings first when it has any. */
  const openDialogForJobType = useCallback(
    (jobType: JobType) => {
      if (jobType === "verify_captions") void openVerifyCaptionsDialog();
      else if (jobType === "watermark") void openWatermarkDialog();
      else setOpenJobType(jobType);
    },
    [openVerifyCaptionsDialog, openWatermarkDialog],
  );

  return { dialogs, openDialogForJobType };
}
