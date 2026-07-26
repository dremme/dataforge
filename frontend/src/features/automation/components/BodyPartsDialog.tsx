import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  updateBodyPartsSettings,
  type BodyPartsSettings,
} from "@/features/automation/preferences/bodyPartsPreferences";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface BodyPartsDialogProps {
  folderLabel: string;
  initialSettings: BodyPartsSettings;
  busy?: boolean;
  onConfirm: (settings: BodyPartsSettings) => void;
  onCancel: () => void;
}

export function BodyPartsDialog({
  folderLabel,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: BodyPartsDialogProps) {
  const [bodyDescription, setBodyDescription] = useState(initialSettings.bodyDescription);
  const [faceDescription, setFaceDescription] = useState(initialSettings.faceDescription);
  const [keywords, setKeywords] = useState(initialSettings.keywords);
  const [elementDescription, setElementDescription] = useState(initialSettings.elementDescription);
  const [saving, setSaving] = useState(false);
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const bodyDescriptionId = useId();
  const faceDescriptionId = useId();
  const keywordsId = useId();
  const elementDescriptionId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  const handleConfirm = useCallback(async () => {
    if (busy || saving) return;
    const settings = { bodyDescription, faceDescription, keywords, elementDescription };
    setSaving(true);
    try {
      const saved = await updateBodyPartsSettings(settings);
      onConfirm(saved);
    } catch {
      // Job start also persists settings.
      onConfirm(settings);
    } finally {
      setSaving(false);
    }
  }, [bodyDescription, busy, elementDescription, faceDescription, keywords, onConfirm, saving]);

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
        className="confirm-dialog__panel body-parts-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="body-parts-dialog-title"
        aria-describedby="body-parts-dialog-description"
      >
        <header className="confirm-dialog__header">
          <h2 id="body-parts-dialog-title" className="confirm-dialog__title">
            Start body parts detection?
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

        <p id="body-parts-dialog-description" className="confirm-dialog__description">
          Detect body and face regions, optionally distinct body-parts, and write Ideogram 4 .json
          sidecars for images in <strong>{folderLabel}</strong>.
        </p>

        <div className="body-parts-dialog__field">
          <label htmlFor={bodyDescriptionId} className="body-parts-dialog__label">
            Body description
          </label>
          <input
            id={bodyDescriptionId}
            className="body-parts-dialog__input body-parts-dialog__input--single"
            value={bodyDescription}
            onChange={(e) => setBodyDescription(e.target.value)}
            placeholder="e.g. the persons' body"
            disabled={confirmDisabled}
          />
        </div>

        <div className="body-parts-dialog__field">
          <label htmlFor={faceDescriptionId} className="body-parts-dialog__label">
            Face description
          </label>
          <input
            id={faceDescriptionId}
            className="body-parts-dialog__input body-parts-dialog__input--single"
            value={faceDescription}
            onChange={(e) => setFaceDescription(e.target.value)}
            placeholder="e.g. the persons' face"
            disabled={confirmDisabled}
          />
        </div>

        <div className="body-parts-dialog__field">
          <label htmlFor={elementDescriptionId} className="body-parts-dialog__label">
            Body-part description
          </label>
          <input
            id={elementDescriptionId}
            className="body-parts-dialog__input body-parts-dialog__input--single"
            value={elementDescription}
            onChange={(e) => setElementDescription(e.target.value)}
            placeholder="e.g. the subject's hat"
            disabled={confirmDisabled}
          />
        </div>

        <div className="body-parts-dialog__field">
          <label htmlFor={keywordsId} className="body-parts-dialog__label">
            Body-part keywords
          </label>
          <textarea
            id={keywordsId}
            className="body-parts-dialog__input"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="e.g. hat, sunglasses, jewelry"
            rows={2}
            disabled={confirmDisabled}
            data-scroll-lock-allow
          />
          <p className="body-parts-dialog__hint">
            Comma-separated keywords for body-part detection.
          </p>
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
            {busy ? "Starting..." : saving ? "Saving..." : "Start detection"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
