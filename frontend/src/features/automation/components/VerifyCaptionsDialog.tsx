import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconBrain, iconX } from "@/shared/icons";
import {
  cacheVerifyCaptionsSettings,
  loadVerifyCaptionsSettings,
  readCachedVerifyCaptionsSettings,
  type VerifyCaptionsMode,
} from "@/features/automation/preferences/verifyCaptionsPreferences";
import { Icon } from "@/shared/ui/Icon";

export type { VerifyCaptionsMode };

interface VerifyCaptionsDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (mode: VerifyCaptionsMode, context: string) => void;
  onCancel: () => void;
}

export function VerifyCaptionsDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: VerifyCaptionsDialogProps) {
  const cachedSettings = readCachedVerifyCaptionsSettings();
  const [mode, setMode] = useState<VerifyCaptionsMode>(cachedSettings?.mode ?? "instruct");
  const [context, setContext] = useState(cachedSettings?.context ?? "");
  const [loadingSettings, setLoadingSettings] = useState(!cachedSettings);
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const reasoningId = useId();
  const instructId = useId();
  const contextId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    if (readCachedVerifyCaptionsSettings()) return;

    let cancelled = false;
    loadVerifyCaptionsSettings()
      .then((settings) => {
        if (cancelled) return;
        setMode(settings.mode);
        setContext(settings.context);
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy || loadingSettings) return;
    const settings = { mode, context };
    cacheVerifyCaptionsSettings(settings);
    onConfirm(mode, context);
  }, [busy, context, loadingSettings, mode, onConfirm]);

  useScrollLock(true, "confirm-dialog-open");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy || loadingSettings) return;

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
        handleConfirm();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, handleConfirm, loadingSettings, onCancel]);

  return createPortal(
    <div className="confirm-dialog" role="presentation">
      <button
        type="button"
        className={backdropClass}
        aria-label="Close dialog"
        onClick={onCancel}
        disabled={busy}
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
            disabled={busy}
          >
            <Icon icon={iconX} />
          </button>
        </header>

        <p id="verify-captions-dialog-description" className="confirm-dialog__description">
          Verify captions for images in <strong>{folderLabel}</strong> using the local LLM model{" "}
          <span className="confirm-dialog__model-badge">
            <Icon icon={iconBrain} className="confirm-dialog__model-badge-icon" />
            Qwen3.6
          </span>
          . Images with caption issues will be marked with an exclamation mark.
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
                disabled={busy || loadingSettings}
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
                disabled={busy || loadingSettings}
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
            disabled={busy || loadingSettings}
            data-scroll-lock-allow
          />
        </div>

        <footer className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--default"
            onClick={handleConfirm}
            disabled={busy || loadingSettings}
          >
            {busy ? "Starting..." : loadingSettings ? "Loading..." : "Start verify captions"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
