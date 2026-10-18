import { useCallback, useId, useState } from "react";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { RadioTileGroup, type RadioTileOption } from "@/shared/ui/RadioTileGroup";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
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

interface WatermarkModalProps {
  scope: ModalScopeInfo;
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

export function WatermarkModal({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: WatermarkModalProps) {
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
    <Modal
      unsavedChanges={
        text !== initialSettings.text ||
        size !== initialSettings.size ||
        opacity !== initialSettings.opacity ||
        position !== initialSettings.position ||
        stripMetadata !== initialSettings.strip_metadata
      }
      scope={scope}
      title="Add watermark?"
      description={
        <>
          Originals stay untouched — marked copies go to the <strong>watermarked</strong> subfolder,
          without caption sidecars.
        </>
      }
      panelClassName="watermark-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      describedById={error ? errorId : undefined}
      footer={
        <ModalActions
          confirmLabel="Add watermark"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="modal__field">
        <label htmlFor={textId} className="modal__label">
          Watermark text
        </label>
        <input
          id={textId}
          type="text"
          className="modal__input"
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
        <p className="modal__hint">Shown in semi-transparent white, for a video's full length.</p>
        {error && (
          <p id={errorId} className="modal__error" role="alert">
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

      <div className="modal__field">
        <label className="modal__checkbox" htmlFor={stripId}>
          <input
            id={stripId}
            type="checkbox"
            className="modal__checkbox-input"
            checked={stripMetadata}
            onChange={(event) => setStripMetadata(event.target.checked)}
            disabled={busy}
          />
          <span className="modal__checkbox-box" aria-hidden="true" />
          <span className="modal__checkbox-label">Strip metadata from the copies</span>
        </label>
        <p className="modal__hint">Remove embedded metadata from media files.</p>
      </div>
    </Modal>
  );
}
