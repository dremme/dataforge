import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cacheBodyPartsSettings,
  loadBodyPartsSettings,
  readCachedBodyPartsSettings,
  type BodyPartsSettings,
} from "@/features/automation/preferences/bodyPartsPreferences";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { iconX } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface BodyPartsDialogProps {
  folderLabel: string;
  busy?: boolean;
  onConfirm: (settings: BodyPartsSettings) => void;
  onCancel: () => void;
}

export function BodyPartsDialog({
  folderLabel,
  busy = false,
  onConfirm,
  onCancel,
}: BodyPartsDialogProps) {
  const cachedSettings = readCachedBodyPartsSettings();
  const [bodyDescription, setBodyDescription] = useState(cachedSettings?.bodyDescription ?? "");
  const [faceDescription, setFaceDescription] = useState(cachedSettings?.faceDescription ?? "");
  const [keywords, setKeywords] = useState(cachedSettings?.keywords ?? "");
  const [elementDescription, setElementDescription] = useState(
    cachedSettings?.elementDescription ?? "",
  );
  const [loadingSettings, setLoadingSettings] = useState(!cachedSettings);
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  const bodyDescriptionId = useId();
  const faceDescriptionId = useId();
  const keywordsId = useId();
  const elementDescriptionId = useId();

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    if (readCachedBodyPartsSettings()) return;

    let cancelled = false;
    loadBodyPartsSettings()
      .then((settings) => {
        if (cancelled) return;
        setBodyDescription(settings.bodyDescription);
        setFaceDescription(settings.faceDescription);
        setKeywords(settings.keywords);
        setElementDescription(settings.elementDescription);
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
    const settings = { bodyDescription, faceDescription, keywords, elementDescription };
    cacheBodyPartsSettings(settings);
    onConfirm(settings);
  }, [
    bodyDescription,
    busy,
    elementDescription,
    faceDescription,
    keywords,
    loadingSettings,
    onConfirm,
  ]);

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
            disabled={busy}
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
            disabled={busy || loadingSettings}
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
            disabled={busy || loadingSettings}
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
            disabled={busy || loadingSettings}
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
            disabled={busy || loadingSettings}
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
            {busy ? "Starting..." : loadingSettings ? "Loading..." : "Start detection"}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
