import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VisionModelBadge } from "@/features/automation/components/VisionModelBadge";
import {
  updateVerifyCaptionsSettings,
  type VerifyCaptionsMode,
  type VerifyCaptionsSettings,
} from "@/features/automation/preferences/verifyCaptionsPreferences";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

export type { VerifyCaptionsMode };

interface VerifyCaptionsDialogProps {
  folderPath: string;
  folderLabel: string;
  initialSettings: VerifyCaptionsSettings;
  busy?: boolean;
  onConfirm: (mode: VerifyCaptionsMode, context: string) => void;
  onCancel: () => void;
}

export function VerifyCaptionsDialog({
  folderPath,
  folderLabel,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: VerifyCaptionsDialogProps) {
  const [mode, setMode] = useState<VerifyCaptionsMode>(initialSettings.mode);
  const [context, setContext] = useState(initialSettings.context);
  const [saving, setSaving] = useState(false);
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const reasoningId = useId();
  const instructId = useId();
  const contextId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const handleConfirm = useCallback(async () => {
    if (busy || saving) return;
    setSaving(true);
    try {
      const settings = await updateVerifyCaptionsSettings(folderPath, { mode, context });
      onConfirm(settings.mode, settings.context);
    } catch {
      // Job start also persists settings.
      onConfirm(mode, context);
    } finally {
      setSaving(false);
    }
  }, [busy, context, folderPath, mode, onConfirm, saving]);

  useScrollLock(true, "confirm-dialog-open");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy || saving) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        if ((event.target as HTMLElement)?.tagName === "TEXTAREA") {
          return;
        }
        event.preventDefault();
        void handleConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, handleConfirm, onCancel, saving]);

  const confirmDisabled = busy || saving;
  const confirmLabel = busy ? "Starting..." : saving ? "Saving..." : "Start verify captions";

  return createPortal(
    <div className="confirm-dialog" role="presentation">
      <button
        type="button"
        className={backdropClass}
        aria-label="Close dialog"
        onClick={onCancel}
        disabled={busy || saving}
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        className="confirm-dialog__panel verify-captions-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="verify-captions-dialog-title"
        aria-describedby="verify-captions-dialog-description"
      >
        <header className="confirm-dialog__header">
          <h2 id="verify-captions-dialog-title" className="confirm-dialog__title">
            Start verify captions?
          </h2>
          <button
            type="button"
            className="confirm-dialog__close"
            onClick={onCancel}
            aria-label="Close"
            disabled={busy || saving}
          >
            <Icon icon={iconX} />
          </button>
        </header>

        <p id="verify-captions-dialog-description" className="confirm-dialog__description">
          Verify captions for images in <strong>{folderLabel}</strong> using <VisionModelBadge />.
          Images with caption issues will be marked with an exclamation mark.
        </p>

        <div className="verify-captions-dialog__field">
          <div className="verify-captions-dialog__label">Mode</div>
          <div
            className="verify-captions-dialog__options"
            role="radiogroup"
            aria-label="Verification mode"
          >
            <label
              className={`verify-captions-dialog__option${mode === "thinking" ? " verify-captions-dialog__option--selected" : ""}`}
              htmlFor={reasoningId}
            >
              <input
                id={reasoningId}
                type="radio"
                name="verify-captions-mode"
                className="verify-captions-dialog__radio-input"
                value="thinking"
                checked={mode === "thinking"}
                onChange={() => setMode("thinking")}
                disabled={confirmDisabled}
              />
              <span className="verify-captions-dialog__radio" aria-hidden="true" />
              <div className="verify-captions-dialog__option-content">
                <span className="verify-captions-dialog__option-title">Reasoning</span>
                <span className="verify-captions-dialog__option-desc">
                  Slower, but better overall outcome
                </span>
              </div>
            </label>

            <label
              className={`verify-captions-dialog__option${mode === "instruct" ? " verify-captions-dialog__option--selected" : ""}`}
              htmlFor={instructId}
            >
              <input
                id={instructId}
                type="radio"
                name="verify-captions-mode"
                className="verify-captions-dialog__radio-input"
                value="instruct"
                checked={mode === "instruct"}
                onChange={() => setMode("instruct")}
                disabled={confirmDisabled}
              />
              <span className="verify-captions-dialog__radio" aria-hidden="true" />
              <div className="verify-captions-dialog__option-content">
                <span className="verify-captions-dialog__option-title">Instruct</span>
                <span className="verify-captions-dialog__option-desc">
                  Faster, but makes more mistakes
                </span>
              </div>
            </label>
          </div>
        </div>

        <div className="verify-captions-dialog__field">
          <label htmlFor={contextId} className="verify-captions-dialog__label">
            Additional context
          </label>
          <textarea
            id={contextId}
            className="verify-captions-dialog__input"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Optional notes about the dataset, e.g. typical poses or recurring subjects"
            rows={3}
            disabled={confirmDisabled}
            data-scroll-lock-allow
          />
        </div>

        <footer className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--secondary"
            onClick={onCancel}
            disabled={busy || saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--primary"
            onClick={() => void handleConfirm()}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
