import { useCallback, useMemo, useState } from "react";
import { trainLoraBody, type TrainLoraSettings } from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionDialog";
import type { ComfyProcessSettings } from "@/features/automation/components/ComfyProcessDialog";
import type { ReplaceCaptionsSettings } from "@/features/automation/components/ReplaceCaptionsDialog";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsDialog";
import {
  loadAutomationSettings,
  type AutomationSettings,
} from "@/features/automation/preferences/automationPreferences";
import type { AutomationDialogsState } from "@/features/automation/types";
import type { JobStartBodies, JobStartBody } from "@/shared/api/jobStartBodies";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type {
  DuplicateThreshold,
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
  /** Files a job will actually touch: the selection, or the whole folder. */
  itemCount: number;
  /** Every file in the folder, for jobs the selection cannot narrow. */
  folderItemCount: number;
  /** True while a selection is scoping jobs to part of the folder. */
  selectionActive: boolean;
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
  folderItemCount,
  selectionActive,
  startJob,
  getJobPaths,
}: UseAutomationDialogOverlaysOptions) {
  // At most one dialog is ever open, so one job type beats a boolean per dialog.
  const [openJobType, setOpenJobType] = useState<JobType | null>(null);
  // This folder's saved settings, loaded before any dialog opens.
  const [settings, setSettings] = useState<AutomationSettings | null>(null);

  const closeDialog = useCallback(() => {
    setOpenJobType(null);
    setSettings(null);
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

  const scope = useMemo<DialogScopeInfo>(
    () => ({ itemCount, folderLabel, fromSelection: selectionActive }),
    [folderLabel, itemCount, selectionActive],
  );

  const trainLoraScope = useMemo<DialogScopeInfo>(
    () => ({
      itemCount: folderItemCount,
      folderLabel,
      fromSelection: false,
      note: selectionActive
        ? "AI-Toolkit trains on the whole folder, so the current selection does not narrow it."
        : undefined,
    }),
    [folderItemCount, folderLabel, selectionActive],
  );

  const dialogs = useMemo<AutomationDialogsState>(() => {
    const shared = <K extends keyof AutomationSettings & JobType>(jobType: K) => ({
      open: openJobType === jobType,
      scope,
      // Every dialog starts from what its last run used, so there is no job type
      // here that reads its settings differently from the rest.
      initialSettings: settings?.[jobType] ?? null,
      busy: startingJobType === jobType,
      onCancel: closeDialog,
    });

    return {
      setCaptions: {
        ...shared("set_captions"),
        onConfirm: (caption: string, overwrite: boolean) =>
          startJobFromDialog("set_captions", { caption, overwrite }),
      },
      replaceCaptions: {
        ...shared("replace_captions"),
        folderPath: folderPath ?? "",
        // The same selection the job will run on, so the preview counts what it edits.
        selectedPaths: getJobPaths?.(),
        onConfirm: (edit: ReplaceCaptionsSettings) =>
          startJobFromDialog("replace_captions", {
            mode: edit.mode,
            search: edit.search,
            replacement: edit.replacement,
            use_regex: edit.useRegex,
            case_sensitive: edit.caseSensitive,
          }),
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
      editCaptions: {
        ...shared("edit_captions"),
        onConfirm: (
          mode: VerifyCaptionsMode,
          instruction: string,
          reasoningEffort: ReasoningEffort,
          preserveThinking: boolean,
          backup: boolean,
        ) =>
          startJobFromDialog("edit_captions", {
            mode,
            instruction,
            reasoning_effort: reasoningEffort,
            preserve_thinking: preserveThinking,
            backup,
          }),
      },
      findDuplicates: {
        ...shared("find_duplicates"),
        onConfirm: (threshold: DuplicateThreshold) =>
          startJobFromDialog("find_duplicates", { threshold }),
      },
      batchRename: {
        ...shared("batch_rename"),
        onConfirm: (stem: string, startNumber: number) =>
          startJobFromDialog("batch_rename", { stem, start_number: startNumber }),
      },
      trainLora: {
        ...shared("train_lora"),
        scope: trainLoraScope,
        onConfirm: (draft: TrainLoraSettings) =>
          startJobFromDialog("train_lora", trainLoraBody(draft)),
      },
      watermark: {
        ...shared("watermark"),
        onConfirm: (
          text: string,
          size: WatermarkSizeName,
          opacity: WatermarkOpacity,
          position: WatermarkPosition,
        ) => startJobFromDialog("watermark", { text, size, opacity, position }),
      },
      comfyProcess: {
        ...shared("comfy_process"),
        onConfirm: (draft: ComfyProcessSettings) =>
          startJobFromDialog("comfy_process", {
            preset: draft.preset,
            seed: draft.seed,
            prompt_text: draft.promptText,
            overwrite_candidates: draft.overwriteCandidates,
          }),
      },
    };
  }, [
    closeDialog,
    folderPath,
    getJobPaths,
    openJobType,
    scope,
    settings,
    startJobFromDialog,
    startingJobType,
    trainLoraScope,
  ]);

  /** Shows a job type's dialog, loading this folder's saved settings first. */
  const openDialogForJobType = useCallback(
    (jobType: JobType) => {
      if (!folderPath) return;
      void (async () => {
        setSettings(await loadAutomationSettings(folderPath));
        setOpenJobType(jobType);
      })();
    },
    [folderPath],
  );

  return { dialogs, openDialogForJobType };
}
