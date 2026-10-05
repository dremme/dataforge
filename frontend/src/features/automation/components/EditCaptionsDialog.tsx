import { useCallback, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { previewCaptionEdits } from "@/features/automation/api/jobs";
import { CaptionPreviewSample } from "@/features/automation/components/CaptionPreviewSample";
import {
  AutomationModeSelector,
  type AutomationMode,
} from "@/features/automation/components/AutomationModeSelector";
import {
  ReasoningEffortSelector,
  type ReasoningEffort,
} from "@/features/automation/components/ReasoningEffortSelector";
import { VisionModelBadge } from "@/features/automation/components/VisionModelBadge";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { formatApiError } from "@/shared/api/http";
import { CAPTION_EDIT_PREVIEW_LIMIT } from "@/shared/constants";
import { iconInfo } from "@/shared/icons";
import { Dialog, DialogActions, DialogButton } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { Icon } from "@/shared/ui/Icon";

interface EditCaptionsDialogProps {
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["edit_captions"];
  folderPath: string;
  selectedPaths?: string[];
  busy?: boolean;
  onConfirm: (
    mode: AutomationMode,
    instruction: string,
    reasoningEffort: ReasoningEffort,
    preserveThinking: boolean,
    backup: boolean,
  ) => void;
  onCancel: () => void;
}

export function EditCaptionsDialog({
  scope,
  initialSettings,
  folderPath,
  selectedPaths,
  busy = false,
  onConfirm,
  onCancel,
}: EditCaptionsDialogProps) {
  const [mode, setMode] = useState<AutomationMode>(initialSettings.mode);
  const [instruction, setInstruction] = useState(initialSettings.instruction);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialSettings.reasoning_effort,
  );
  const [preserveThinking, setPreserveThinking] = useState(initialSettings.preserve_thinking);
  // Never restored: this is the safety net, and the dangerous state is the unticked one.
  // A remembered "no backup" would be both sticky and invisible.
  const [backup, setBackup] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const instructionId = useId();
  const preserveThinkingId = useId();
  const backupId = useId();
  const errorId = useId();

  const request = {
    instruction: instruction.trim(),
    mode,
    reasoning_effort: reasoningEffort,
    preserve_thinking: preserveThinking,
    paths: selectedPaths,
  };
  const preview = useQuery({
    queryKey: ["edit-captions-preview", folderPath, request],
    queryFn: ({ signal }) => previewCaptionEdits(folderPath, request, signal),
    enabled: false,
    retry: false,
    gcTime: 0,
  });
  const controlsBusy = busy || preview.isFetching;

  const handlePreview = () => {
    if (controlsBusy) return;
    if (!instruction.trim()) {
      setError("Enter an instruction for the edit.");
      instructionRef.current?.focus();
      return;
    }
    setError(null);
    void preview.refetch();
  };

  const handleConfirm = useCallback(() => {
    if (controlsBusy) return;

    if (!instruction.trim()) {
      setError("Enter an instruction for the edit.");
      instructionRef.current?.focus();
      return;
    }

    setError(null);
    // Starting the job is what stores these, exactly as it is for every other dialog.
    onConfirm(mode, instruction.trim(), reasoningEffort, preserveThinking, backup);
  }, [backup, controlsBusy, instruction, mode, onConfirm, preserveThinking, reasoningEffort]);

  return (
    <Dialog
      scope={scope}
      title="Start edit captions?"
      description={
        <>
          Rewrites each caption with <VisionModelBadge /> from your instruction. Only the caption
          text is sent, never the media.
        </>
      }
      panelClassName="edit-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={instructionRef}
      describedById={error ? errorId : undefined}
      footer={
        <>
          <div className="edit-captions-dialog__dry-run-action">
            <DialogButton
              label={preview.isFetching ? "Running..." : "Dry run"}
              variant="secondary"
              busy={preview.isFetching}
              disabled={busy}
              onClick={handlePreview}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.stopPropagation();
              }}
            />
          </div>
          <DialogActions
            confirmLabel="Start edit captions"
            busyLabel="Starting..."
            busy={busy}
            confirmDisabled={preview.isFetching}
            onConfirm={handleConfirm}
            onCancel={onCancel}
          />
        </>
      }
    >
      <div className="edit-captions-dialog__body">
        <AutomationModeSelector
          value={mode}
          name="edit-captions-mode"
          groupLabel="Edit mode"
          disabled={controlsBusy}
          onChange={setMode}
        />

        <ReasoningEffortSelector
          value={reasoningEffort}
          name="edit-captions-reasoning-effort"
          groupLabel="Edit reasoning effort"
          disabled={mode === "instruct" || controlsBusy}
          onChange={setReasoningEffort}
        />

        <div className="dialog__field edit-captions-dialog__toggles">
          <div>
            <label className="dialog__checkbox" htmlFor={preserveThinkingId}>
              <input
                id={preserveThinkingId}
                type="checkbox"
                className="dialog__checkbox-input"
                checked={preserveThinking}
                onChange={(event) => setPreserveThinking(event.target.checked)}
                disabled={mode === "instruct" || controlsBusy}
              />
              <span className="dialog__checkbox-box" aria-hidden="true" />
              <span className="dialog__checkbox-label">Preserve thinking</span>
            </label>
            <p className="dialog__hint">Keeps earlier reasoning in the prompt.</p>
          </div>

          <div>
            <label className="dialog__checkbox" htmlFor={backupId}>
              <input
                id={backupId}
                type="checkbox"
                className="dialog__checkbox-input"
                checked={backup}
                onChange={(event) => setBackup(event.target.checked)}
                disabled={controlsBusy}
              />
              <span className="dialog__checkbox-box" aria-hidden="true" />
              <span className="dialog__checkbox-label">Back up captions first</span>
            </label>
            <p className="dialog__hint">
              Originals go to <strong>.backup</strong>, ready for Restore captions.
            </p>
          </div>
        </div>

        <div className="dialog__field">
          <label htmlFor={instructionId} className="dialog__label">
            Edit instruction
          </label>
          <textarea
            id={instructionId}
            ref={instructionRef}
            className="dialog__input dialog__input--multiline"
            value={instruction}
            onChange={(event) => {
              setInstruction(event.target.value);
              setError(null);
            }}
            placeholder="e.g. Rewrite each caption in present tense"
            rows={2}
            disabled={controlsBusy}
            data-scroll-lock-allow
          />
        </div>

        <div className="dialog__field edit-captions-dialog__preview">
          <p className="dialog__hint edit-captions-dialog__dry-run-hint">
            <Icon icon={iconInfo} className="edit-captions-dialog__dry-run-hint-icon" />
            <span>
              Dry run tests up to {CAPTION_EDIT_PREVIEW_LIMIT} readable captions in filename order.
              It leaves files unchanged; the full job generates fresh results.
            </span>
          </p>
          <div role="status" aria-busy={preview.isFetching || undefined}>
            {preview.isFetching ? (
              <p className="dialog__hint">Generating sample edits...</p>
            ) : preview.isError ? (
              <p className="dialog__error">{formatApiError(preview.error)}</p>
            ) : preview.data ? (
              preview.data.samples.length > 0 ? (
                <ul className="edit-captions-dialog__samples">
                  {preview.data.samples.map((sample) => (
                    <CaptionPreviewSample key={sample.name} {...sample} />
                  ))}
                </ul>
              ) : (
                <p className="dialog__hint">No readable captions found in this scope.</p>
              )
            ) : null}
          </div>
        </div>

        {error && (
          <p id={errorId} className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
