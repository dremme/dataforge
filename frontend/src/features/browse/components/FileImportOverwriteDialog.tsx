import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";
import { useOverlayBackdropClass } from "@/shared/hooks/useOverlayBackdropClass";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { Icon } from "@/shared/ui/Icon";
import { iconAlertTriangle, iconX } from "@/shared/icons";

type FileImportOverwriteDialogProps = {
  conflicts: string[];
  busy?: boolean;
  title?: string;
  descriptionSuffix?: string;
  skipLabel?: string;
  onReplaceExisting: () => void;
  onCopyNewOnly: () => void;
  onCancel: () => void;
};

export function FileImportOverwriteDialog({
  conflicts,
  busy = false,
  title = "Replace existing files?",
  descriptionSuffix = "Choose whether to replace them or import only new files.",
  skipLabel = "Skip existing",
  onReplaceExisting,
  onCopyNewOnly,
  onCancel,
}: FileImportOverwriteDialogProps) {
  const backdropClass = useOverlayBackdropClass("confirm-dialog__backdrop");
  useScrollLock(true, "confirm-dialog-open");

  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  const conflictPreview =
    conflicts.length <= 3
      ? conflicts.join(", ")
      : `${conflicts.slice(0, 3).join(", ")} and ${conflicts.length - 3} more`;

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
        className="confirm-dialog__panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="file-import-overwrite-title"
        aria-describedby="file-import-overwrite-description"
      >
        <header className="confirm-dialog__header">
          <h2 id="file-import-overwrite-title" className="confirm-dialog__title">
            {title}
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

        <p id="file-import-overwrite-description" className="confirm-dialog__description">
          {conflicts.length === 1 ? (
            <>
              <strong>{conflictPreview}</strong> already exists in this folder.
            </>
          ) : (
            <>
              <strong>{conflicts.length} files</strong> already exist in this folder, including{" "}
              <strong>{conflictPreview}</strong>.
            </>
          )}
          <br />
          {descriptionSuffix}
        </p>

        <footer className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--warning"
            onClick={onReplaceExisting}
            disabled={busy}
          >
            <Icon icon={iconAlertTriangle} className="confirm-dialog__btn-icon" />
            Replace existing
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--primary"
            onClick={onCopyNewOnly}
            disabled={busy}
          >
            {skipLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
