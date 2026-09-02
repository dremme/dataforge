import { useCallback, useId, useState } from "react";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type { WatermarkOpacity, WatermarkPosition, WatermarkSizeName } from "@/shared/types";

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
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["watermark"];
  busy?: boolean;
  onConfirm: (
    text: string,
    size: WatermarkSizeName,
    opacity: WatermarkOpacity,
    position: WatermarkPosition,
    stripMetadata: boolean,
  ) => void;
  onCancel: () => void;
}

export function WatermarkDialog({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: WatermarkDialogProps) {
  const [text, setText] = useState(initialSettings.text);
  const [size, setSize] = useState<WatermarkSizeName>(initialSettings.size);
  const [opacity, setOpacity] = useState<WatermarkOpacity>(initialSettings.opacity);
  const [position, setPosition] = useState<WatermarkPosition>(initialSettings.position);
  const [stripMetadata, setStripMetadata] = useState(initialSettings.strip_metadata);
  const [error, setError] = useState<string | null>(null);
  const textId = useId();
  const errorId = useId();
  const groupId = useId();
  const stripId = useId();

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
    onConfirm(trimmed, size, opacity, position, stripMetadata);
  }, [busy, onConfirm, opacity, position, size, stripMetadata, text]);

  return (
    <Dialog
      scope={scope}
      title="Add watermark?"
      description={
        <>
          Originals stay untouched — marked copies go to the <strong>watermarked</strong> subfolder,
          without caption sidecars.
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

      <div className="dialog__field">
        <label className="dialog__checkbox" htmlFor={stripId}>
          <input
            id={stripId}
            type="checkbox"
            className="dialog__checkbox-input"
            checked={stripMetadata}
            onChange={(event) => setStripMetadata(event.target.checked)}
            disabled={busy}
          />
          <span className="dialog__checkbox-box" aria-hidden="true" />
          <span className="dialog__checkbox-label">Strip metadata from the copies</span>
        </label>
        <p className="dialog__hint">Remove embedded metadata from media files.</p>
      </div>
    </Dialog>
  );
}
