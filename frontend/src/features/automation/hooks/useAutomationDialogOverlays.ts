import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import {
  snapshotBulkScope,
  type BulkScopeKind,
  type BulkScopeSnapshot,
} from "@/features/automation/lib/bulkScope";
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
  /** Files a job will touch, before job-specific eligibility checks. */
  itemCount: number;
  /** Every file in the folder, for jobs the selection cannot narrow. */
  folderItemCount: number;
  scopeKind?: BulkScopeKind;
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
  scopeKind = "folder",
  startJob,
  getJobPaths,
}: UseAutomationDialogOverlaysOptions) {
  // At most one dialog is ever open, so one job type beats a boolean per dialog.
  const [openJobType, setOpenJobType] = useState<JobType | null>(null);
  // This folder's saved settings, loaded before any dialog opens.
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [snapshot, setSnapshot] = useState<BulkScopeSnapshot | null>(null);
  const folderRef = useRef(folderPath);
  folderRef.current = folderPath;
  const openRevisionRef = useRef(0);

  const closeDialog = useCallback(() => {
    setOpenJobType(null);
    setSettings(null);
    setSnapshot(null);
    openRevisionRef.current += 1;
  }, []);

  useEffect(() => closeDialog(), [closeDialog, folderPath]);

  /** Closes the dialog, then starts its job; a rejection is already reported by the context. */
  const startJobFromDialog = useCallback(
    <T extends JobType>(jobType: T, body?: JobStartBodies[T]) => {
      if (!folderPath || (jobType !== "train_lora" && snapshot?.paths?.length === 0)) return;
      closeDialog();
      startJob(
        jobType,
        folderPath,
        body,
        jobType === "train_lora" ? undefined : snapshot?.paths,
      ).catch(() => {});
    },
    [closeDialog, folderPath, snapshot, startJob],
  );

  const scope = useMemo<DialogScopeInfo>(
    () => snapshot?.scope ?? { itemCount, folderLabel, kind: scopeKind },
    [folderLabel, itemCount, scopeKind, snapshot],
  );

  const trainLoraScope = useMemo<DialogScopeInfo>(
    () => ({
      itemCount: folderItemCount,
      folderLabel,
      kind: "folder",
      note: "AI-Toolkit trains on the whole folder. Search, filters, and selection do not limit training.",
    }),
    [folderItemCount, folderLabel],
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
        selectedPaths: snapshot?.paths ?? getJobPaths?.(),
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
        folderPath: folderPath ?? "",
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
        folderPath: folderPath ?? "",
        selectedPaths: snapshot?.paths ?? getJobPaths?.(),
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
          stripMetadata: boolean,
        ) =>
          startJobFromDialog("watermark", {
            text,
            size,
            opacity,
            position,
            strip_metadata: stripMetadata,
          }),
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
      autoAdjust: {
        open: openJobType === "auto_adjust",
        scope,
        busy: startingJobType === "auto_adjust",
        onCancel: closeDialog,
        onConfirm: (replaceAdjustments: boolean, resetAdjustments: boolean) =>
          startJobFromDialog("auto_adjust", {
            replace_adjustments: replaceAdjustments,
            reset_adjustments: resetAdjustments,
          }),
      },
      checkCaptionRules: {
        open: openJobType === "check_caption_rules",
        scope,
        busy: startingJobType === "check_caption_rules",
        folderPath: folderPath ?? "",
        onCancel: closeDialog,
        onConfirm: () => startJobFromDialog("check_caption_rules"),
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
    snapshot,
  ]);

  /** Shows a job type's dialog, loading this folder's saved settings first. */
  const openDialogForJobType = useCallback(
    (jobType: JobType, override?: BulkScopeSnapshot) => {
      if (!folderPath) return;
      const paths = override?.paths ?? getJobPaths?.();
      if (jobType !== "train_lora" && paths?.length === 0) return;
      setSnapshot(
        snapshotBulkScope(override?.scope ?? { itemCount, folderLabel, kind: scopeKind }, paths),
      );
      const revision = ++openRevisionRef.current;
      void (async () => {
        const loaded = await loadAutomationSettings(folderPath, queryClient);
        if (folderRef.current !== folderPath || revision !== openRevisionRef.current) return;
        setSettings(loaded);
        setOpenJobType(jobType);
      })();
    },
    [folderPath, queryClient, getJobPaths, itemCount, folderLabel, scopeKind],
  );

  return { dialogs, openDialogForJobType };
}
