import { useCallback, useId, useRef, useState } from "react";
import type { TrainLoraSettings } from "@/features/automation/api/jobs";
import {
  DEFAULT_TRAINING_PROMPTS,
  TRAINING_MODEL_OPTIONS,
  cleanTrainingPrompts,
  trainingModelLabel,
  validateLoraName,
} from "@/features/automation/lib/training";
import { useTrainingTemplateDraft } from "@/features/automation/hooks/useTrainingTemplateDraft";
import type { TrainingModel } from "@/shared/types";
import { iconFilePen, iconPlus, iconTrash2, iconTriangleAlert } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import { ModalSelect } from "@/shared/ui/ModalSelect";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { TrainingTemplateEditorModal } from "./TrainingTemplateEditorModal";

interface PromptRow {
  id: number;
  text: string;
}

interface TrainLoraModalProps {
  scope: ModalScopeInfo;
  initialSettings: JobSettingsByType["train_lora"];
  busy?: boolean;
  onConfirm: (settings: TrainLoraSettings) => void;
  onCancel: () => void;
}

export function TrainLoraModal({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: TrainLoraModalProps) {
  const [model, setModel] = useState<TrainingModel>(initialSettings.model);
  // Never restored: the name is the run's identity on disk and its resume key, so
  // confirming without editing it must never attach to an earlier training run.
  const [loraName, setLoraName] = useState("");
  const [triggerWord, setTriggerWord] = useState(initialSettings.trigger_word);
  const [prompts, setPrompts] = useState<PromptRow[]>(() =>
    (initialSettings.prompts.length ? initialSettings.prompts : DEFAULT_TRAINING_PROMPTS).map(
      (text, index) => ({ id: index, text }),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const templateDraft = useTrainingTemplateDraft(model);

  // Rows keep their identity across edits so removing one cannot move focus.
  const nextPromptId = useRef(initialSettings.prompts.length || DEFAULT_TRAINING_PROMPTS.length);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
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
    <Modal
      unsavedChanges={
        model !== initialSettings.model ||
        loraName !== "" ||
        triggerWord !== initialSettings.trigger_word ||
        templateDraft.hasDrafts ||
        JSON.stringify(prompts.map((row) => row.text)) !==
          JSON.stringify(
            initialSettings.prompts.length ? initialSettings.prompts : DEFAULT_TRAINING_PROMPTS,
          )
      }
      scope={scope}
      title="Start LoRA training?"
      description={<>Trains a {trainingModelLabel(model)} LoRA on them in Ostris AI-Toolkit.</>}
      panelClassName="train-lora-modal"
      busy={busy}
      suspended={templateDraft.editorOpen}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={nameRef}
      describedById={error || templateDraft.loadError ? errorId : undefined}
      footer={
        <ModalActions
          confirmLabel="Start training"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="train-lora-modal__body" data-scroll-lock-allow>
        <ModalSelect
          label="Model"
          value={model}
          options={TRAINING_MODEL_OPTIONS}
          disabled={busy}
          onChange={setModel}
        />

        <div className="train-lora-modal__template">
          <button
            type="button"
            className="train-lora-modal__template-button"
            onClick={() => void templateDraft.openEditor()}
            disabled={busy || templateDraft.loading}
          >
            <Icon icon={iconFilePen} className="train-lora-modal__template-icon" />
            {templateDraft.loading ? "Opening..." : "Edit template"}
          </button>
          {templateDraft.edited ? (
            <span className="train-lora-modal__template-note train-lora-modal__template-note--edited">
              <Icon icon={iconTriangleAlert} className="train-lora-modal__template-note-icon" />
              This run uses your edited template, not the stock one.
            </span>
          ) : (
            <span className="train-lora-modal__template-note">
              Tweak steps, learning rate or resolution for this run.
            </span>
          )}
        </div>

        <div className="modal__field train-lora-modal__names">
          <div className="train-lora-modal__name">
            <label htmlFor={nameId} className="modal__label">
              LoRA name
            </label>
            <input
              id={nameId}
              ref={nameRef}
              type="text"
              className="modal__input"
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

          <div className="train-lora-modal__name">
            <label htmlFor={triggerWordId} className="modal__label">
              Trigger word (optional)
            </label>
            <input
              id={triggerWordId}
              type="text"
              className="modal__input"
              value={triggerWord}
              onChange={(event) => setTriggerWord(event.target.value)}
              placeholder="e.g. mtnstyle"
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>

        <div className="modal__field train-lora-modal__prompts-field">
          <div className="train-lora-modal__prompts-header">
            <span id={promptsId} className="modal__label">
              Sample prompts
            </span>
            <button
              type="button"
              className="train-lora-modal__add-prompt"
              onClick={addPrompt}
              disabled={busy}
            >
              <Icon icon={iconPlus} className="train-lora-modal__add-prompt-icon" />
              Add prompt
            </button>
          </div>

          {prompts.length === 0 ? (
            <p className="train-lora-modal__prompts-empty">
              AI-Toolkit renders one sample per prompt as the LoRA trains. Add at least one to watch
              it take shape.
            </p>
          ) : (
            <ul
              className="train-lora-modal__prompts"
              aria-labelledby={promptsId}
              data-scroll-lock-allow
            >
              {prompts.map((row, index) => (
                <li key={row.id} className="train-lora-modal__prompt">
                  <span className="train-lora-modal__prompt-index" aria-hidden="true">
                    {index + 1}
                  </span>
                  <input
                    type="text"
                    className="train-lora-modal__prompt-input"
                    value={row.text}
                    onChange={(event) => updatePrompt(row.id, event.target.value)}
                    placeholder="Describe a sample to generate"
                    aria-label={`Sample prompt ${index + 1}`}
                    autoComplete="off"
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="train-lora-modal__prompt-remove"
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
          <p id={errorId} className="modal__error" role="alert">
            {error ?? templateDraft.loadError}
          </p>
        )}
      </div>

      {templateDraft.editorOpen && (
        <TrainingTemplateEditorModal
          model={model}
          initialContent={templateDraft.template ?? templateDraft.stockTemplate}
          stockContent={templateDraft.stockTemplate}
          onClose={templateDraft.closeEditor}
          onApply={templateDraft.applyTemplate}
        />
      )}
    </Modal>
  );
}
