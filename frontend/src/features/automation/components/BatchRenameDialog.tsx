import { useCallback, useId, useState } from "react";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

const INVALID_STEM_PATTERN = /[<>:"/\\|?*]/;

interface BatchRenameDialogProps {
  folderLabel: string;
  itemCount: number;
  busy?: boolean;
  onConfirm: (stem: string) => void;
  onCancel: () => void;
}

export function BatchRenameDialog({
  folderLabel,
  itemCount,
  busy = false,
  onConfirm,
  onCancel,
}: BatchRenameDialogProps) {
  const [stem, setStem] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stemId = useId();
  const errorId = useId();

  const padding = Math.max(3, String(itemCount).length);
  const previewStem = stem.trim() || "mountain";
  const previewName = `${previewStem}_${"1".padStart(padding, "0")}.png`;

  const handleConfirm = useCallback(() => {
    if (busy) return;

    const trimmed = stem.trim();
    if (!trimmed) {
      setError("Enter a name stem.");
      return;
    }
    if (INVALID_STEM_PATTERN.test(trimmed)) {
      setError("Name stem contains invalid characters.");
      return;
    }

    setError(null);
    onConfirm(trimmed);
  }, [busy, onConfirm, stem]);

  return (
    <Dialog
      title="Rename files?"
      description={
        <>
          Rename <strong>{itemCount}</strong> supported media {itemCount === 1 ? "file" : "files"}{" "}
          in <strong>{folderLabel}</strong>. Caption sidecars ({CAPTION_SIDECAR_EXTENSION_LIST})
          move with each file. This action cannot be undone.
        </>
      }
      panelClassName="batch-rename-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Rename"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label htmlFor={stemId} className="dialog__label">
          Name stem
        </label>
        <input
          id={stemId}
          type="text"
          className="dialog__input"
          value={stem}
          onChange={(event) => {
            setStem(event.target.value);
            setError(null);
          }}
          placeholder="e.g. mountain"
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        <p className="dialog__hint">
          Example: <code>{previewName}</code>
        </p>
        {error && (
          <p id={errorId} className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
