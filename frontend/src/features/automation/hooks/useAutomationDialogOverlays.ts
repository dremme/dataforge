import { useCallback, useMemo, useState } from "react";
import {
  bodyPartsBody,
  trainLoraBody,
  type JobStartBody,
  type TrainLoraSettings,
} from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import {
  loadBodyPartsSettings,
  type BodyPartsSettings,
} from "@/features/automation/preferences/bodyPartsPreferences";
import {
  loadVerifyCaptionsSettings,
  type VerifyCaptionsSettings,
} from "@/features/automation/preferences/verifyCaptionsPreferences";
import type { AutomationDialogsState } from "@/features/automation/types";
import type { JobType } from "@/shared/types";

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
  const [bodyPartsSettings, setBodyPartsSettings] = useState<BodyPartsSettings | null>(null);
  const [verifyCaptionsSettings, setVerifyCaptionsSettings] =
    useState<VerifyCaptionsSettings | null>(null);

  const closeDialog = useCallback(() => {
    setOpenJobType(null);
    setBodyPartsSettings(null);
    setVerifyCaptionsSettings(null);
  }, []);

  /** Closes the dialog, then starts its job; a rejection is already reported by the context. */
  const startJobFromDialog = useCallback(
    (jobType: JobType, body?: JobStartBody) => {
      if (!folderPath) return;
      closeDialog();
      startJob(jobType, folderPath, body, getJobPaths?.()).catch(() => {});
    },
    [closeDialog, folderPath, getJobPaths, startJob],
  );

  const openBodyPartsDialog = useCallback(async () => {
    if (!folderPath) return;
    const settings = await loadBodyPartsSettings();
    setBodyPartsSettings(settings);
    setOpenJobType("body_parts");
  }, [folderPath]);

  const openVerifyCaptionsDialog = useCallback(async () => {
    if (!folderPath) return;
    const settings = await loadVerifyCaptionsSettings(folderPath);
    setVerifyCaptionsSettings(settings);
    setOpenJobType("verify_captions");
  }, [folderPath]);

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
      bodyParts: {
        ...shared("body_parts"),
        initialSettings: bodyPartsSettings,
        onConfirm: (settings: BodyPartsSettings) =>
          startJobFromDialog("body_parts", bodyPartsBody(settings)),
      },
      autoCaption: {
        ...shared("auto_caption"),
        onConfirm: (mode: AutoCaptionMode) => startJobFromDialog("auto_caption", { mode }),
      },
      verifyCaptions: {
        ...shared("verify_captions"),
        folderPath: folderPath ?? "",
        initialSettings: verifyCaptionsSettings,
        onConfirm: (mode: VerifyCaptionsMode, context: string) =>
          startJobFromDialog("verify_captions", { mode, context }),
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
    };
  }, [
    bodyPartsSettings,
    closeDialog,
    folderLabel,
    folderPath,
    itemCount,
    openJobType,
    startJobFromDialog,
    startingJobType,
    verifyCaptionsSettings,
  ]);

  /** Shows a job type's dialog, loading its saved settings first when it has any. */
  const openDialogForJobType = useCallback(
    (jobType: JobType) => {
      if (jobType === "body_parts") void openBodyPartsDialog();
      else if (jobType === "verify_captions") void openVerifyCaptionsDialog();
      else setOpenJobType(jobType);
    },
    [openBodyPartsDialog, openVerifyCaptionsDialog],
  );

  return { dialogs, openDialogForJobType };
}
