import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trainLoraBody, type TrainLoraSettings } from "@/features/automation/api/jobs";
import type { AutoCaptionMode } from "@/features/automation/components/AutoCaptionModal";
import type { ComfyProcessSettings } from "@/features/automation/components/ComfyProcessModal";
import type { ReplaceCaptionsSettings } from "@/features/automation/components/ReplaceCaptionsModal";
import type { VerifyCaptionsMode } from "@/features/automation/components/VerifyCaptionsModal";
import {
  loadAutomationSettings,
  type AutomationSettings,
} from "@/features/automation/preferences/automationPreferences";
import type { AutomationModalsState } from "@/features/automation/types";
import type { JobStartBodies, JobStartBody } from "@/shared/api/jobStartBodies";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
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
import { useLatestRef } from "@/shared/hooks/useLatestRef";
import { useChanged } from "@/shared/hooks/useChanged";

type UseAutomationModalOverlaysOptions = {
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

export function useAutomationModalOverlays({
  folderPath,
  folderLabel,
  startingJobType,
  itemCount,
  folderItemCount,
  scopeKind = "folder",
  startJob,
  getJobPaths,
}: UseAutomationModalOverlaysOptions) {
  // At most one modal is ever open, so one job type beats a boolean per modal.
  const [openJobType, setOpenJobType] = useState<JobType | null>(null);
  // This folder's saved settings, loaded before any modal opens.
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [snapshot, setSnapshot] = useState<BulkScopeSnapshot | null>(null);
  const folderRef = useLatestRef(folderPath);
  const openRevisionRef = useRef(0);

  const closeModal = useCallback(() => {
    setOpenJobType(null);
    setSettings(null);
    setSnapshot(null);
    openRevisionRef.current += 1;
  }, []);

  if (useChanged(folderPath)) {
    setOpenJobType(null);
    setSettings(null);
    setSnapshot(null);
  }
  useEffect(() => {
    openRevisionRef.current += 1;
  }, [folderPath]);

  /** Closes the modal, then starts its job; a rejection is already reported by the context. */
  const startJobFromModal = useCallback(
    <T extends JobType>(jobType: T, body?: JobStartBodies[T]) => {
      if (!folderPath || (jobType !== "train_lora" && snapshot?.paths?.length === 0)) return;
      closeModal();
      startJob(
        jobType,
        folderPath,
        body,
        jobType === "train_lora" ? undefined : snapshot?.paths,
      ).catch(() => {});
    },
    [closeModal, folderPath, snapshot, startJob],
  );

  const scope = useMemo<ModalScopeInfo>(
    () => snapshot?.scope ?? { itemCount, folderLabel, kind: scopeKind },
    [folderLabel, itemCount, scopeKind, snapshot],
  );

  const trainLoraScope = useMemo<ModalScopeInfo>(
    () => ({
      itemCount: folderItemCount,
      folderLabel,
      kind: "folder",
      note: "AI-Toolkit trains on the whole folder. Search, filters, and selection do not limit training.",
    }),
    [folderItemCount, folderLabel],
  );

  const modals = useMemo<AutomationModalsState>(() => {
    const shared = <K extends keyof AutomationSettings & JobType>(jobType: K) => ({
      open: openJobType === jobType,
      scope,
      // Every modal starts from what its last run used, so there is no job type
      // here that reads its settings differently from the rest.
      initialSettings: settings?.[jobType] ?? null,
      busy: startingJobType === jobType,
      onCancel: closeModal,
    });

    return {
      setCaptions: {
        ...shared("set_captions"),
        onConfirm: (caption: string, overwrite: boolean) =>
          startJobFromModal("set_captions", { caption, overwrite }),
      },
      replaceCaptions: {
        ...shared("replace_captions"),
        folderPath: folderPath ?? "",
        // The same selection the job will run on, so the preview counts what it edits.
        selectedPaths: snapshot?.paths ?? getJobPaths?.(),
        onConfirm: (edit: ReplaceCaptionsSettings) =>
          startJobFromModal("replace_captions", {
            mode: edit.mode,
            search: edit.search,
            replacement: edit.replacement,
            use_regex: edit.useRegex,
            case_sensitive: edit.caseSensitive,
            backup: edit.backup,
          }),
      },
      backupCaptions: {
        ...shared("backup_captions"),
        onConfirm: () => startJobFromModal("backup_captions"),
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
          startJobFromModal("auto_caption", {
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
          startJobFromModal("verify_captions", {
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
          startJobFromModal("edit_captions", {
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
          startJobFromModal("find_duplicates", { threshold }),
      },
      batchRename: {
        ...shared("batch_rename"),
        onConfirm: (stem: string, startNumber: number) =>
          startJobFromModal("batch_rename", { stem, start_number: startNumber }),
      },
      trainLora: {
        ...shared("train_lora"),
        scope: trainLoraScope,
        onConfirm: (draft: TrainLoraSettings) =>
          startJobFromModal("train_lora", trainLoraBody(draft)),
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
          startJobFromModal("watermark", {
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
          startJobFromModal("comfy_process", {
            preset: draft.preset,
            seed: draft.seed,
            prompt_text: draft.promptText,
            overwrite_candidates: draft.overwriteCandidates,
          }),
      },
      resize: {
        ...shared("resize"),
        onConfirm: (megapixels: number, multiple: number, resetSize: boolean) =>
          startJobFromModal("resize", { megapixels, multiple, reset_size: resetSize }),
      },
      autoAdjust: {
        open: openJobType === "auto_adjust",
        scope,
        busy: startingJobType === "auto_adjust",
        onCancel: closeModal,
        onConfirm: (replaceAdjustments: boolean, resetAdjustments: boolean) =>
          startJobFromModal("auto_adjust", {
            replace_adjustments: replaceAdjustments,
            reset_adjustments: resetAdjustments,
          }),
      },
      checkCaptionRules: {
        open: openJobType === "check_caption_rules",
        scope,
        busy: startingJobType === "check_caption_rules",
        folderPath: folderPath ?? "",
        onCancel: closeModal,
        onConfirm: () => startJobFromModal("check_caption_rules"),
      },
    };
  }, [
    closeModal,
    folderPath,
    getJobPaths,
    openJobType,
    scope,
    settings,
    startJobFromModal,
    startingJobType,
    trainLoraScope,
    snapshot,
  ]);

  /** Shows a job type's modal, loading this folder's saved settings first. */
  const openModalForJobType = useCallback(
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
    [folderLabel, folderPath, folderRef, getJobPaths, itemCount, queryClient, scopeKind],
  );

  return { modals, openModalForJobType };
}
