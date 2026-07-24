import { useCallback, useMemo, useState } from "react";
import type { BodyPartsSettings } from "@/features/automation/preferences/bodyPartsPreferences";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import type { AutomationDialogsState } from "@/features/automation/types";

type UseAutomationDialogOverlaysOptions = {
  folderPath: string | undefined;
  folderLabel: string;
  startingSetCaptions: boolean;
  startingBodyParts: boolean;
  startingAutoCaption: boolean;
  startingVerifyCaptions: boolean;
  startingBatchRename: boolean;
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
  startingSetCaptions,
  startingBodyParts,
  startingAutoCaption,
  startingVerifyCaptions,
  startingBatchRename,
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
  const [autoCaptionOpen, setAutoCaptionOpen] = useState(false);
  const [verifyCaptionsOpen, setVerifyCaptionsOpen] = useState(false);
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

  const dialogs = useMemo<AutomationDialogsState>(
    () => ({
      setCaptions: {
        open: setCaptionsOpen,
        folderLabel,
        busy: startingSetCaptions,
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
        busy: startingBodyParts,
        onConfirm: (settings) => {
          startJobFromDialog(
            () => setBodyPartsOpen(false),
            () => startBodyPartsJob(folderPath!, settings, getJobPaths?.()),
          );
        },
        onCancel: () => setBodyPartsOpen(false),
      },
      autoCaption: {
        open: autoCaptionOpen,
        folderLabel,
        busy: startingAutoCaption,
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
        folderLabel,
        busy: startingVerifyCaptions,
        onConfirm: (mode, context) => {
          startJobFromDialog(
            () => setVerifyCaptionsOpen(false),
            () => startVerifyCaptionsJob(folderPath!, mode, context, getJobPaths?.()),
          );
        },
        onCancel: () => setVerifyCaptionsOpen(false),
      },
      batchRename: {
        open: batchRenameOpen,
        folderLabel,
        itemCount,
        busy: startingBatchRename,
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
      folderLabel,
      folderPath,
      itemCount,
      setCaptionsOpen,
      verifyCaptionsOpen,
      getJobPaths,
      startAutoCaptionJob,
      startBatchRenameJob,
      startBodyPartsJob,
      startJobFromDialog,
      startSetCaptionsJob,
      startVerifyCaptionsJob,
      startingAutoCaption,
      startingBatchRename,
      startingBodyParts,
      startingSetCaptions,
      startingVerifyCaptions,
    ],
  );

  return {
    dialogs,
    openSetCaptionsDialog: () => setSetCaptionsOpen(true),
    openBodyPartsDialog: () => setBodyPartsOpen(true),
    openAutoCaptionDialog: () => setAutoCaptionOpen(true),
    openVerifyCaptionsDialog: () => setVerifyCaptionsOpen(true),
    openBatchRenameDialog: () => setBatchRenameOpen(true),
  };
}
