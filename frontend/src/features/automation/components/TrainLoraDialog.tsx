import { useCallback, useId, useRef, useState } from "react";
import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import {
  DEFAULT_TRAINING_MODEL,
  DEFAULT_TRAINING_PROMPTS,
  TRAINING_MODEL_OPTIONS,
  cleanTrainingPrompts,
  trainingModelLabel,
  validateLoraName,
} from "@/features/automation/lib/training";
import { useTrainingTemplateDraft } from "@/features/automation/hooks/useTrainingTemplateDraft";
import type { TrainingModel } from "@/shared/types";
import { iconFilePen, iconPlus, iconTrash2 } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { RadioTileGroup } from "@/shared/ui/RadioTileGroup";
import { TrainingTemplateEditorDialog } from "./TrainingTemplateEditorDialog";

interface PromptRow {
  id: number;
  text: string;
}

interface TrainLoraDialogProps {
  /** Files this run will touch and the folder they are in; rendered above the copy. */
  scope: DialogScopeInfo;
  busy?: boolean;
  onConfirm: (settings: TrainLoraSettings) => void;
  onCancel: () => void;
}

export function TrainLoraDialog({
  scope,
  busy = false,
  onConfirm,
  onCancel,
}: TrainLoraDialogProps) {
  const [model, setModel] = useState<TrainingModel>(DEFAULT_TRAINING_MODEL);
  const [loraName, setLoraName] = useState("");
  const [triggerWord, setTriggerWord] = useState("");
  const [prompts, setPrompts] = useState<PromptRow[]>(() =>
    DEFAULT_TRAINING_PROMPTS.map((text, index) => ({ id: index, text })),
  );
  const [error, setError] = useState<string | null>(null);
  const templateDraft = useTrainingTemplateDraft(model);

  // Rows keep their identity across edits so removing one cannot move focus.
  const nextPromptId = useRef(DEFAULT_TRAINING_PROMPTS.length);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const modelGroupId = useId();
  const triggerWordId = useId();
  const promptsId = useId();
  const errorId = useId();

  const updatePrompt = useCallback((id: number, text: string) => {
    setPrompts((current) => current.map((row) => (row.id === id ? { ...row, text } : row)));
    setError(null);
  }, []);

  const removePrompt = useCallback((id: number) => {
    setPrompts((current) => current.filter((row) => row.id !== id));
    setError(null);
  }, []);

  const addPrompt = useCallback(() => {
    setPrompts((current) => [...current, { id: nextPromptId.current++, text: "" }]);
    setError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy) return;

    const nameError = validateLoraName(loraName);
    if (nameError) {
      setError(nameError);
      nameRef.current?.focus();
      return;
    }

    const cleanedPrompts = cleanTrainingPrompts(prompts.map((row) => row.text));
    if (cleanedPrompts.length === 0) {
      setError("Add at least one example prompt.");
      return;
    }

    setError(null);
    onConfirm({
      loraName: loraName.trim(),
      triggerWord: triggerWord.trim(),
      prompts: cleanedPrompts,
      model,
      template: templateDraft.template,
    });
  }, [busy, loraName, model, onConfirm, prompts, templateDraft.template, triggerWord]);

  return (
    <Dialog
      scope={scope}
      title="Start LoRA training?"
      description={<>Trains a {trainingModelLabel(model)} LoRA on them in Ostris AI-Toolkit.</>}
      panelClassName="train-lora-dialog"
      busy={busy}
      suspended={templateDraft.editorOpen}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={nameRef}
      describedById={error || templateDraft.loadError ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Start training"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="train-lora-dialog__body" data-scroll-lock-allow>
        <RadioTileGroup
          value={model}
          options={TRAINING_MODEL_OPTIONS}
          label="Model"
          name={`${modelGroupId}-model`}
          groupLabel="Training model"
          disabled={busy}
          onChange={setModel}
        />

        <div className="train-lora-dialog__template">
          <button
            type="button"
            className="train-lora-dialog__template-button"
            onClick={() => void templateDraft.openEditor()}
            disabled={busy || templateDraft.loading}
          >
            <Icon icon={iconFilePen} className="train-lora-dialog__template-icon" />
            {templateDraft.loading ? "Opening..." : "Edit template"}
          </button>
          <span className="train-lora-dialog__template-note">
            {templateDraft.edited
              ? "Edited for this run."
              : "Tweak steps, learning rate or resolution for this run."}
          </span>
        </div>

        <div className="dialog__field train-lora-dialog__names">
          <div className="train-lora-dialog__name">
            <label htmlFor={nameId} className="dialog__label">
              LoRA name
            </label>
            <input
              id={nameId}
              ref={nameRef}
              type="text"
              className="dialog__input"
              value={loraName}
              onChange={(event) => {
                setLoraName(event.target.value);
                setError(null);
              }}
              placeholder="e.g. mountain_style_v1"
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </div>

          <div className="train-lora-dialog__name">
            <label htmlFor={triggerWordId} className="dialog__label">
              Trigger word (optional)
            </label>
            <input
              id={triggerWordId}
              type="text"
              className="dialog__input"
              value={triggerWord}
              onChange={(event) => setTriggerWord(event.target.value)}
              placeholder="e.g. mtnstyle"
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>

        <div className="dialog__field train-lora-dialog__prompts-field">
          <div className="train-lora-dialog__prompts-header">
            <span id={promptsId} className="dialog__label">
              Sample prompts
            </span>
            <button
              type="button"
              className="train-lora-dialog__add-prompt"
              onClick={addPrompt}
              disabled={busy}
            >
              <Icon icon={iconPlus} className="train-lora-dialog__add-prompt-icon" />
              Add prompt
            </button>
          </div>

          {prompts.length === 0 ? (
            <p className="train-lora-dialog__prompts-empty">
              AI-Toolkit renders one sample per prompt as the LoRA trains. Add at least one to watch
              it take shape.
            </p>
          ) : (
            <ul
              className="train-lora-dialog__prompts"
              aria-labelledby={promptsId}
              data-scroll-lock-allow
            >
              {prompts.map((row, index) => (
                <li key={row.id} className="train-lora-dialog__prompt">
                  {/* The input's own name already carries the number for assistive tech. */}
                  <span className="train-lora-dialog__prompt-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    className="train-lora-dialog__prompt-input"
                    value={row.text}
                    onChange={(event) => updatePrompt(row.id, event.target.value)}
                    placeholder="Describe a sample to generate"
                    aria-label={`Sample prompt ${index + 1}`}
                    autoComplete="off"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="train-lora-dialog__prompt-remove"
                    onClick={() => removePrompt(row.id)}
                    aria-label={`Remove Sample prompt ${index + 1}`}
                    disabled={busy}
                  >
                    <Icon icon={iconTrash2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(error || templateDraft.loadError) && (
          <p id={errorId} className="dialog__error" role="alert">
            {error ?? templateDraft.loadError}
          </p>
        )}
      </div>

      {templateDraft.editorOpen && (
        <TrainingTemplateEditorDialog
          model={model}
          initialContent={templateDraft.template ?? templateDraft.stockTemplate}
          stockContent={templateDraft.stockTemplate}
          onClose={templateDraft.closeEditor}
          onApply={templateDraft.applyTemplate}
        />
      )}
    </Dialog>
  );
}
