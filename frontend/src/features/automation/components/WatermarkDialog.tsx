import { useCallback, useId, useState } from "react";
import type { WatermarkSettings } from "@/features/automation/preferences/watermarkPreferences";
import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { WatermarkOpacity, WatermarkPosition, WatermarkSizeName } from "@/shared/types";

/**
 * Mirrors ``normalize_watermark_text`` in ``backend/automation/watermark.py``, minus its
 * control-character rule: a single-line input drops those on paste, so only the backend
 * can ever meet one.
 */
export const MAX_WATERMARK_TEXT_LENGTH = 120;

const SIZES: ReadonlyArray<RadioTileOption<WatermarkSizeName>> = [
  { value: "small", title: "Small" },
  { value: "medium", title: "Medium" },
  { value: "large", title: "Large" },
];

const OPACITIES: ReadonlyArray<RadioTileOption<`${WatermarkOpacity}`>> = [
  { value: "25", title: "25%" },
  { value: "50", title: "50%" },
  { value: "75", title: "75%" },
];

const POSITIONS: ReadonlyArray<RadioTileOption<WatermarkPosition>> = [
  { value: "top", title: "Top" },
  { value: "center", title: "Center" },
  { value: "bottom", title: "Bottom" },
];

interface WatermarkDialogProps {
  folderLabel: string;
  itemCount: number;
  initialSettings: WatermarkSettings;
  busy?: boolean;
  onConfirm: (
    text: string,
    size: WatermarkSizeName,
    opacity: WatermarkOpacity,
    position: WatermarkPosition,
  ) => void;
  onCancel: () => void;
}

export function WatermarkDialog({
  folderLabel,
  itemCount,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: WatermarkDialogProps) {
  const [text, setText] = useState(initialSettings.text);
  const [size, setSize] = useState<WatermarkSizeName>(initialSettings.size);
  const [opacity, setOpacity] = useState<WatermarkOpacity>(initialSettings.opacity);
  const [position, setPosition] = useState<WatermarkPosition>(initialSettings.position);
  const [error, setError] = useState<string | null>(null);
  const textId = useId();
  const errorId = useId();
  const groupId = useId();

  const handleConfirm = useCallback(() => {
    if (busy) return;

    const trimmed = text.trim();
    if (!trimmed) {
      setError("Enter the watermark text.");
      return;
    }
    if (trimmed.length > MAX_WATERMARK_TEXT_LENGTH) {
      setError(`Watermark text cannot be longer than ${MAX_WATERMARK_TEXT_LENGTH} characters.`);
      return;
    }

    setError(null);
    onConfirm(trimmed, size, opacity, position);
  }, [busy, onConfirm, opacity, position, size, text]);

  return (
    <Dialog
      title="Add watermark?"
      description={
        <>
          Write your text onto <strong>{itemCount}</strong> supported media{" "}
          {itemCount === 1 ? "file" : "files"} in <strong>{folderLabel}</strong>. The originals stay
          untouched: the marked copies are saved to the <strong>watermarked</strong> subfolder,
          without their caption sidecars.
        </>
      }
      panelClassName="watermark-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Add watermark"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label htmlFor={textId} className="dialog__label">
          Watermark text
        </label>
        <input
          id={textId}
          type="text"
          className="dialog__input"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          placeholder="e.g. (c) Sample Studio"
          maxLength={MAX_WATERMARK_TEXT_LENGTH}
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        <p className="dialog__hint">Shown in semi-transparent white, for a video's full length.</p>
        {error && (
          <p id={errorId} className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <RadioTileGroup
        value={size}
        options={SIZES}
        label="Size"
        name={`${groupId}-size`}
        groupLabel="Watermark size"
        disabled={busy}
        onChange={setSize}
      />

      <RadioTileGroup
        value={`${opacity}` as const}
        options={OPACITIES}
        label="Opacity"
        name={`${groupId}-opacity`}
        groupLabel="Watermark opacity"
        disabled={busy}
        onChange={(value) => setOpacity(Number(value) as WatermarkOpacity)}
      />

      <RadioTileGroup
        value={position}
        options={POSITIONS}
        label="Position"
        name={`${groupId}-position`}
        groupLabel="Watermark position"
        disabled={busy}
        onChange={setPosition}
      />
    </Dialog>
  );
}
