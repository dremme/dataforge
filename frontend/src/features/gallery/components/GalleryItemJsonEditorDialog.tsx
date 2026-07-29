import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { iconX } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { parseJsonContent } from "@/shared/lib/format";
import { useEditorOverlayEscape } from "@/shared/hooks/useEditorOverlayEscape";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { DialogActions } from "@/shared/ui/Dialog";
import { Icon } from "@/shared/ui/Icon";
import { JsonEditor } from "@/shared/ui/JsonEditor";

interface GalleryItemJsonEditorDialogProps {
  itemName: string;
  initialContent: string;
  sessionKey: number;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  onSave: (jsonContent: string) => void;
}

export const GalleryItemJsonEditorDialog = memo(function GalleryItemJsonEditorDialog({
  itemName,
  initialContent,
  sessionKey,
  saving,
  saveError,
  onClose,
  onSave,
}: GalleryItemJsonEditorDialogProps) {
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

  const overlayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(overlayRef, true);
  useEditorOverlayEscape(overlayRef, onClose, !saving);

  const validationError = parseError ?? saveError;
  const characterCount = draft.length;
  const lineCount = useMemo(() => (draft.length === 0 ? 0 : draft.split("\n").length), [draft]);

  const close = useCallback(() => {
    if (saving) return;
    onClose();
  }, [onClose, saving]);

  const backdropClass = useOverlayBackdropClass("gallery-item-json-editor__backdrop");

  return createPortal(
    <div
      ref={overlayRef}
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
            <DialogActions
              confirmLabel="Save .json"
              busyLabel="Saving..."
              busy={saving}
              onConfirm={handleSave}
              onCancel={close}
            />
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
});
