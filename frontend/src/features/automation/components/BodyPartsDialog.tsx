import { useCallback, useId, useState } from "react";
import {
  updateBodyPartsSettings,
  type BodyPartsSettings,
} from "@/features/automation/preferences/bodyPartsPreferences";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

interface BodyPartsDialogProps {
  folderLabel: string;
  initialSettings: BodyPartsSettings;
  busy?: boolean;
  onConfirm: (settings: BodyPartsSettings) => void;
  onCancel: () => void;
}

export function BodyPartsDialog({
  folderLabel,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: BodyPartsDialogProps) {
  const [bodyDescription, setBodyDescription] = useState(initialSettings.bodyDescription);
  const [faceDescription, setFaceDescription] = useState(initialSettings.faceDescription);
  const [keywords, setKeywords] = useState(initialSettings.keywords);
  const [elementDescription, setElementDescription] = useState(initialSettings.elementDescription);
  const [saving, setSaving] = useState(false);

  const bodyDescriptionId = useId();
  const faceDescriptionId = useId();
  const keywordsId = useId();
  const elementDescriptionId = useId();

  const handleConfirm = useCallback(() => {
    if (busy || saving) return;

    const settings = { bodyDescription, faceDescription, keywords, elementDescription };
    setSaving(true);
    void updateBodyPartsSettings(settings)
      .then(onConfirm)
      .catch(() => {
        // Job start also persists settings.
        onConfirm(settings);
      })
      .finally(() => {
        setSaving(false);
      });
  }, [bodyDescription, busy, elementDescription, faceDescription, keywords, onConfirm, saving]);

  const pending = busy || saving;

  return (
    <Dialog
      title="Start body parts detection?"
      description={
        <>
          Detect body and face regions, optionally distinct body-parts, and write Ideogram 4 .json
          sidecars for images in <strong>{folderLabel}</strong>.
        </>
      }
      panelClassName="body-parts-dialog"
      busy={pending}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Start detection"
          busyLabel={busy ? "Starting..." : "Saving..."}
          busy={pending}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label htmlFor={bodyDescriptionId} className="dialog__label">
          Body description
        </label>
        <input
          id={bodyDescriptionId}
          className="dialog__input"
          value={bodyDescription}
          onChange={(event) => setBodyDescription(event.target.value)}
          placeholder="e.g. the persons' body"
          disabled={pending}
        />
      </div>

      <div className="dialog__field">
        <label htmlFor={faceDescriptionId} className="dialog__label">
          Face description
        </label>
        <input
          id={faceDescriptionId}
          className="dialog__input"
          value={faceDescription}
          onChange={(event) => setFaceDescription(event.target.value)}
          placeholder="e.g. the persons' face"
          disabled={pending}
        />
      </div>

      <div className="dialog__field">
        <label htmlFor={elementDescriptionId} className="dialog__label">
          Body-part description
        </label>
        <input
          id={elementDescriptionId}
          className="dialog__input"
          value={elementDescription}
          onChange={(event) => setElementDescription(event.target.value)}
          placeholder="e.g. the subject's hat"
          disabled={pending}
        />
      </div>

      <div className="dialog__field">
        <label htmlFor={keywordsId} className="dialog__label">
          Body-part keywords
        </label>
        <textarea
          id={keywordsId}
          className="dialog__input dialog__input--multiline body-parts-dialog__keywords"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="e.g. hat, sunglasses, jewelry"
          rows={2}
          disabled={pending}
          data-scroll-lock-allow
        />
        <p className="dialog__hint">Comma-separated keywords for body-part detection.</p>
      </div>
    </Dialog>
  );
}
