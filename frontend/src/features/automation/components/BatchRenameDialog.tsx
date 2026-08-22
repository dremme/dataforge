import { useCallback, useId, useState } from "react";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

const INVALID_STEM_PATTERN = /[<>:"/\\|?*]/;
const START_NUMBER_PATTERN = /^\d+$/;

interface BatchRenameDialogProps {
  /** Files this run will touch and the folder they are in; rendered above the copy. */
  scope: DialogScopeInfo;
  busy?: boolean;
  onConfirm: (stem: string, startNumber: number) => void;
  onCancel: () => void;
}

/** Digits wide enough for the highest number in the sequence, never fewer than three. */
function sequencePadding(itemCount: number, startNumber: number): number {
  return Math.max(3, String(Math.max(startNumber + itemCount - 1, startNumber)).length);
}

function sequenceName(stem: string, index: number, padding: number): string {
  return `${stem}_${String(index).padStart(padding, "0")}.png`;
}

export function BatchRenameDialog({
  scope,
  busy = false,
  onConfirm,
  onCancel,
}: BatchRenameDialogProps) {
  const [stem, setStem] = useState("");
  // Held as text so the field can be emptied mid-edit instead of snapping back to 0.
  const [startNumber, setStartNumber] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const stemId = useId();
  const startNumberId = useId();
  const errorId = useId();

  const previewStem = stem.trim() || "mountain";
  const previewStart = START_NUMBER_PATTERN.test(startNumber.trim())
    ? Number(startNumber.trim())
    : 1;
  const { itemCount } = scope;
  const previewPadding = sequencePadding(itemCount, previewStart);
  const previewFirst = sequenceName(previewStem, previewStart, previewPadding);
  const previewLast = sequenceName(previewStem, previewStart + itemCount - 1, previewPadding);

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

    const trimmedStart = startNumber.trim();
    if (!START_NUMBER_PATTERN.test(trimmedStart)) {
      setError("Start number must be a whole number, 0 or higher.");
      return;
    }

    setError(null);
    onConfirm(trimmed, Number(trimmedStart));
  }, [busy, onConfirm, startNumber, stem]);

  return (
    <Dialog
      scope={scope}
      title="Rename files?"
      description={
        <>
          Renames them in sequence. Caption sidecars ({CAPTION_SIDECAR_EXTENSION_LIST}) move with
          each file. This action cannot be undone.
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
        {/* Side by side: the stem and the number it counts from are one thought, and
            the row costs one field of height instead of two. */}
        <div className="batch-rename-dialog__row">
          <div className="batch-rename-dialog__stem">
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
          </div>
          <div className="batch-rename-dialog__start">
            <label htmlFor={startNumberId} className="dialog__label">
              Start number
            </label>
            <input
              id={startNumberId}
              type="number"
              className="dialog__input"
              value={startNumber}
              min={0}
              step={1}
              onChange={(event) => {
                setStartNumber(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>
        <p className="dialog__hint">
          Example: <code>{previewFirst}</code>
          {itemCount > 1 && (
            <>
              {" to "}
              <code>{previewLast}</code>
            </>
          )}
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
