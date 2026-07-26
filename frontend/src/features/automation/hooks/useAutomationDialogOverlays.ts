import { useCallback, useMemo, useState } from "react";
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
  startSetCaptionsJob: (
    folder: string,
    caption: string,
    overwrite: boolean,
    paths?: string[],
  ) => Promise<unknown>;
  startBodyPartsJob: (
    folder: string,
    settings: BodyPartsSettings,
    paths?: string[],
  ) => Promise<unknown>;
  startAutoCaptionJob: (
    folder: string,
    mode: AutoCaptionMode,
    paths?: string[],
  ) => Promise<unknown>;
  startVerifyCaptionsJob: (
    folder: string,
    mode: VerifyCaptionsMode,
    context: string,
    paths?: string[],
  ) => Promise<unknown>;
  startBatchRenameJob: (folder: string, stem: string, paths?: string[]) => Promise<unknown>;
  getJobPaths?: () => string[] | undefined;
};

export function useAutomationDialogOverlays({
  folderPath,
  folderLabel,
  startingJobType,
  itemCount,
  startSetCaptionsJob,
  startBodyPartsJob,
  startAutoCaptionJob,
  startVerifyCaptionsJob,
  startBatchRenameJob,
  getJobPaths,
}: UseAutomationDialogOverlaysOptions) {
  const [setCaptionsOpen, setSetCaptionsOpen] = useState(false);
  const [bodyPartsOpen, setBodyPartsOpen] = useState(false);
  const [bodyPartsSettings, setBodyPartsSettings] = useState<BodyPartsSettings | null>(null);
  const [autoCaptionOpen, setAutoCaptionOpen] = useState(false);
  const [verifyCaptionsOpen, setVerifyCaptionsOpen] = useState(false);
  const [verifyCaptionsSettings, setVerifyCaptionsSettings] =
    useState<VerifyCaptionsSettings | null>(null);
  const [batchRenameOpen, setBatchRenameOpen] = useState(false);

  const startJobFromDialog = useCallback(
    (closeDialog: () => void, start: () => Promise<unknown>) => {
      if (!folderPath) return;
      closeDialog();
      start().catch(() => {
        // Errors are stored in jobs context state.
      });
    },
    [folderPath],
  );

  const closeBodyPartsDialog = useCallback(() => {
    setBodyPartsOpen(false);
    setBodyPartsSettings(null);
  }, []);

  const closeVerifyCaptionsDialog = useCallback(() => {
    setVerifyCaptionsOpen(false);
    setVerifyCaptionsSettings(null);
  }, []);

  const openBodyPartsDialog = useCallback(async () => {
    if (!folderPath) return;
    const settings = await loadBodyPartsSettings();
    setBodyPartsSettings(settings);
    setBodyPartsOpen(true);
  }, [folderPath]);

  const openVerifyCaptionsDialog = useCallback(async () => {
    if (!folderPath) return;
    const settings = await loadVerifyCaptionsSettings(folderPath);
    setVerifyCaptionsSettings(settings);
    setVerifyCaptionsOpen(true);
  }, [folderPath]);

  const dialogs = useMemo<AutomationDialogsState>(
    () => ({
      setCaptions: {
        open: setCaptionsOpen,
        folderLabel,
        busy: startingJobType === "set_captions",
        onConfirm: (caption, overwrite) => {
          startJobFromDialog(
            () => setSetCaptionsOpen(false),
            () => startSetCaptionsJob(folderPath!, caption, overwrite, getJobPaths?.()),
          );
        },
        onCancel: () => setSetCaptionsOpen(false),
      },
      bodyParts: {
        open: bodyPartsOpen,
        folderLabel,
        initialSettings: bodyPartsSettings,
        busy: startingJobType === "body_parts",
        onConfirm: (settings) => {
          startJobFromDialog(closeBodyPartsDialog, () =>
            startBodyPartsJob(folderPath!, settings, getJobPaths?.()),
          );
        },
        onCancel: closeBodyPartsDialog,
      },
      autoCaption: {
        open: autoCaptionOpen,
        folderLabel,
        busy: startingJobType === "auto_caption",
        onConfirm: (mode) => {
          startJobFromDialog(
            () => setAutoCaptionOpen(false),
            () => startAutoCaptionJob(folderPath!, mode, getJobPaths?.()),
          );
        },
        onCancel: () => setAutoCaptionOpen(false),
      },
      verifyCaptions: {
        open: verifyCaptionsOpen,
        folderPath: folderPath ?? "",
        folderLabel,
        initialSettings: verifyCaptionsSettings,
        busy: startingJobType === "verify_captions",
        onConfirm: (mode, context) => {
          startJobFromDialog(closeVerifyCaptionsDialog, () =>
            startVerifyCaptionsJob(folderPath!, mode, context, getJobPaths?.()),
          );
        },
        onCancel: closeVerifyCaptionsDialog,
      },
      batchRename: {
        open: batchRenameOpen,
        folderLabel,
        itemCount,
        busy: startingJobType === "batch_rename",
        onConfirm: (stem) => {
          startJobFromDialog(
            () => setBatchRenameOpen(false),
            () => startBatchRenameJob(folderPath!, stem, getJobPaths?.()),
          );
        },
        onCancel: () => setBatchRenameOpen(false),
      },
    }),
    [
      autoCaptionOpen,
      batchRenameOpen,
      bodyPartsOpen,
      bodyPartsSettings,
      closeBodyPartsDialog,
      closeVerifyCaptionsDialog,
      folderLabel,
      folderPath,
      getJobPaths,
      itemCount,
      setCaptionsOpen,
      startAutoCaptionJob,
      startBatchRenameJob,
      startBodyPartsJob,
      startJobFromDialog,
      startSetCaptionsJob,
      startVerifyCaptionsJob,
      startingJobType,
      verifyCaptionsOpen,
      verifyCaptionsSettings,
    ],
  );

  const openDialogForJobType = useCallback(
    (jobType: JobType) => {
      if (jobType === "set_captions") setSetCaptionsOpen(true);
      else if (jobType === "body_parts") void openBodyPartsDialog();
      else if (jobType === "auto_caption") setAutoCaptionOpen(true);
      else if (jobType === "verify_captions") void openVerifyCaptionsDialog();
      else if (jobType === "batch_rename") setBatchRenameOpen(true);
    },
    [openBodyPartsDialog, openVerifyCaptionsDialog],
  );

  return {
    dialogs,
    openDialogForJobType,
    openSetCaptionsDialog: () => setSetCaptionsOpen(true),
    openBodyPartsDialog: () => void openBodyPartsDialog(),
    openAutoCaptionDialog: () => setAutoCaptionOpen(true),
    openVerifyCaptionsDialog: () => void openVerifyCaptionsDialog(),
    openBatchRenameDialog: () => setBatchRenameOpen(true),
  };
}
