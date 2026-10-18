import { useCallback, useId, useRef, useState } from "react";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";

interface SetCaptionsModalProps {
  scope: ModalScopeInfo;
  initialSettings: JobSettingsByType["set_captions"];
  busy?: boolean;
  onConfirm: (caption: string, overwrite: boolean) => void;
  onCancel: () => void;
}

export function SetCaptionsModal({
  scope,
  initialSettings,
  busy = false,
  onConfirm,
  onCancel,
}: SetCaptionsModalProps) {
  const [caption, setCaption] = useState(initialSettings.caption);
  // Never restored: overwriting existing captions is destructive, so it is re-chosen
  // every run however the last one was started.
  const [overwrite, setOverwrite] = useState(false);
  const captionId = useId();
  const overwriteId = useId();
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm(caption, overwrite);
  }, [busy, caption, onConfirm, overwrite]);

  return (
    <Modal
      unsavedChanges={caption !== initialSettings.caption || overwrite}
      scope={scope}
      title="Set captions?"
      description={
        <>
          Writes the provided caption text to each image and video as .txt sidecars. This action
          cannot be undone.
        </>
      }
      panelClassName="set-captions-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={captionRef}
      footer={
        <ModalActions
          confirmLabel="Set captions"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="modal__field">
        <label htmlFor={captionId} className="modal__label">
          Caption text
        </label>
        <textarea
          ref={captionRef}
          id={captionId}
          className="modal__input modal__input--multiline"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="e.g. a scenic mountain landscape at sunset"
          rows={3}
          disabled={busy}
        />
      </div>

      <div className="modal__field">
        <label className="modal__checkbox" htmlFor={overwriteId}>
          <input
            id={overwriteId}
            type="checkbox"
            className="modal__checkbox-input"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
            disabled={busy}
          />
          <span className="modal__checkbox-box" aria-hidden="true" />
          <span className="modal__checkbox-label">Overwrite existing captions</span>
        </label>
      </div>
    </Modal>
  );
}
