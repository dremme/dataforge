import { useCallback, useId, useState } from "react";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { MAX_RESIZE_MEGAPIXELS, MAX_RESIZE_MULTIPLE } from "@/shared/constants";
import { fittedSize } from "@/shared/lib/sizeFit";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

/** Large enough that the budget, not the source, decides every example. */
const EXAMPLE_SOURCES = [
  { label: "16:9", width: 7680, height: 4320 },
  { label: "4:3", width: 8192, height: 6144 },
  { label: "1:1", width: 8192, height: 8192 },
] as const;

interface ResizeDialogProps {
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["resize"];
  busy?: boolean;
  onConfirm: (megapixels: number, multiple: number, resetSize: boolean) => void;
  onCancel: () => void;
}

function parseMegapixels(value: string): number | null {
  const parsed = Number(value.trim());
  return value.trim() && parsed > 0 && parsed <= MAX_RESIZE_MEGAPIXELS ? parsed : null;
}

function parseMultiple(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_RESIZE_MULTIPLE ? parsed : null;
}

export function ResizeDialog({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: ResizeDialogProps) {
  // Held as text so a field can be emptied mid-edit instead of snapping back.
  const [megapixels, setMegapixels] = useState(String(initialSettings.megapixels));
  const [multiple, setMultiple] = useState(String(initialSettings.multiple));
  const [error, setError] = useState<string | null>(null);
  // Never restored: discarding earlier sizing is destructive, so it is re-chosen every run.
  const [reset, setReset] = useState(false);
  const megapixelsId = useId();
  const multipleId = useId();
  const resetId = useId();
  const errorId = useId();

  const parsedMegapixels = parseMegapixels(megapixels);
  const parsedMultiple = parseMultiple(multiple);
  const examples =
    parsedMegapixels !== null && parsedMultiple !== null
      ? EXAMPLE_SOURCES.flatMap((source) => {
          const size = fittedSize(source, {
            megapixels: parsedMegapixels,
            multiple: parsedMultiple,
          });
          return [{ label: source.label, size: size ? `${size.width} × ${size.height}` : "-" }];
        })
      : EXAMPLE_SOURCES.flatMap((source) => [{ label: source.label, size: "-" }]);

  const handleConfirm = useCallback(() => {
    if (busy) return;

    // The fields are ignored on a reset, so the remembered settings travel unchanged.
    if (reset) {
      setError(null);
      onConfirm(initialSettings.megapixels, initialSettings.multiple, true);
      return;
    }
    if (parsedMegapixels === null) {
      setError(`Megapixels must be above 0 and at most ${MAX_RESIZE_MEGAPIXELS}.`);
      return;
    }
    if (parsedMultiple === null) {
      setError(`The pixel multiple must be a whole number from 1 to ${MAX_RESIZE_MULTIPLE}.`);
      return;
    }

    setError(null);
    onConfirm(parsedMegapixels, parsedMultiple, false);
  }, [busy, initialSettings, onConfirm, parsedMegapixels, parsedMultiple, reset]);

  return (
    <Dialog
      scope={scope}
      title={reset ? "Reset size?" : "Resize media?"}
      description={
        reset ? (
          <>Resets the size of each image and video. All other edits are kept.</>
        ) : (
          <>
            Scales each image and MP4 to about this many megapixels at its own aspect ratio, with
            both sides on the pixel grid. The few pixels left over are trimmed from the center, and
            smaller files are never upscaled. Each original is stored so the editor can revert it.
          </>
        )
      }
      panelClassName="resize-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel={reset ? "Reset size" : "Resize"}
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <div className="resize-dialog__row">
          <div>
            <label htmlFor={megapixelsId} className="dialog__label">
              Megapixels
            </label>
            <input
              id={megapixelsId}
              type="number"
              className="dialog__input resize-dialog__number"
              value={megapixels}
              min={0.1}
              max={MAX_RESIZE_MEGAPIXELS}
              step={0.1}
              onChange={(event) => {
                setMegapixels(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              disabled={busy || reset}
            />
          </div>
          <div>
            <label htmlFor={multipleId} className="dialog__label">
              Multiple of (px)
            </label>
            <input
              id={multipleId}
              type="number"
              className="dialog__input resize-dialog__number"
              value={multiple}
              min={1}
              max={MAX_RESIZE_MULTIPLE}
              step={1}
              onChange={(event) => {
                setMultiple(event.target.value);
                setError(null);
              }}
              autoComplete="off"
              disabled={busy || reset}
            />
          </div>
        </div>
        <dl className="resize-dialog__examples" aria-label="Example sizes">
          {examples.map((example) => (
            <div key={example.label} className="resize-dialog__example">
              <dt className="resize-dialog__example-aspect">{example.label}</dt>
              <dd className="resize-dialog__example-size">{example.size}</dd>
            </div>
          ))}
        </dl>
        {error && (
          <p id={errorId} className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={resetId}>
          <input
            id={resetId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={reset}
            onChange={(event) => {
              setReset(event.target.checked);
              setError(null);
            }}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Reset size to the original</span>
        </label>
        <p className="dialog__hint">
          Clears earlier resizes and manual scaling without applying the budget. Crops, masks and
          all other edits are kept.
        </p>
      </div>
    </Dialog>
  );
}
