import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { iconX } from "../icons";
import { classNames } from "../utils/classNames";
import { parseJsonContent } from "../utils/formatJson";
import { useOverlayBackdropClass } from "../hooks/useOverlayBackdropClass";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { Icon } from "./Icon";
import { JsonEditor } from "./JsonEditor";

interface GalleryItemJsonEditorModalProps {
  itemName: string;
  initialContent: string;
  sessionKey: number;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: (jsonContent: string) => void;
}

export const GalleryItemJsonEditorModal = memo(function GalleryItemJsonEditorModal({
  itemName,
  initialContent,
  sessionKey,
  saving,
  saveError,
  onClose,
  onSave,
}: GalleryItemJsonEditorModalProps) {
  const [draft, setDraft] = useState(initialContent);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(initialContent);
    setParseError(null);
  }, [sessionKey, initialContent]);

  const handleSave = useCallback(() => {
    const parsed = parseJsonContent(draft);
    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }

    setParseError(null);
    onSave(JSON.stringify(parsed.value, null, 2));
  }, [draft, onSave]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!saving) {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, saving]);

  const validationError = parseError ?? saveError;
  const characterCount = draft.length;
  const lineCount = useMemo(() => (draft.length === 0 ? 0 : draft.split("\n").length), [draft]);

  const close = () => {
    if (saving) return;
    onClose();
  };

  const backdropClass = useOverlayBackdropClass("gallery-item-json-editor__backdrop");

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  return createPortal(
    <div
      ref={panelRef}
      className="gallery-item-json-editor"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit .json caption for ${itemName}`}
    >
      <button
        type="button"
        className={backdropClass}
        onClick={close}
        aria-label="Close"
        disabled={saving}
        tabIndex={-1}
      />
      <div className="gallery-item-json-editor__panel">
        <header className="gallery-item-json-editor__header">
          <div className="gallery-item-json-editor__header-text">
            <div className="gallery-item-json-editor__header-copy">
              <h2 className="gallery-item-json-editor__title">{itemName}</h2>
              <p className="gallery-item-json-editor__subtitle">
                Edit the full Ideogram 4 .json caption file for this image.
              </p>
            </div>
          </div>
          <div className="gallery-item-json-editor__header-actions">
            <button
              type="button"
              className="gallery-item-json-editor__close"
              onClick={close}
              aria-label="Close"
              disabled={saving}
            >
              <Icon icon={iconX} />
            </button>
          </div>
        </header>

        <div className="gallery-item-json-editor__body">
          <JsonEditor
            key={sessionKey}
            id="gallery-item-json-editor"
            className={classNames(validationError && "code-editor--error")}
            value={draft}
            placeholder="Enter .json caption content..."
            aria-label={`.json caption for ${itemName}`}
            aria-invalid={validationError != null}
            title={validationError ?? undefined}
            onChange={(value) => {
              setDraft(value);
              if (parseError) {
                setParseError(null);
              }
            }}
          />
        </div>

        {validationError && (
          <p className="gallery-item-json-editor__error" role="alert">
            {validationError}
          </p>
        )}

        <footer className="gallery-item-json-editor__footer">
          <div className="gallery-item-json-editor__footer-meta" aria-label=".json statistics">
            <div className="gallery-item-json-editor__meta-item">
              <span className="gallery-item-json-editor__meta-value">
                {characterCount.toLocaleString()}
              </span>
              <span className="gallery-item-json-editor__meta-label">Characters</span>
            </div>
            <span className="gallery-item-json-editor__meta-divider" aria-hidden="true" />
            <div className="gallery-item-json-editor__meta-item">
              <span className="gallery-item-json-editor__meta-value">
                {lineCount.toLocaleString()}
              </span>
              <span className="gallery-item-json-editor__meta-label">Lines</span>
            </div>
          </div>
          <div className="confirm-dialog__actions gallery-item-json-editor__footer-actions">
            <button
              type="button"
              className="confirm-dialog__btn confirm-dialog__btn--secondary"
              onClick={close}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="confirm-dialog__btn confirm-dialog__btn--default"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save .json"}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
});
