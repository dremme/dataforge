import { useCallback, useId, useRef, useState } from "react";
import { Modal, ModalActions } from "@/shared/ui/Modal";

interface CreateFolderModalProps {
  parentLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CreateFolderModal({
  parentLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: CreateFolderModalProps) {
  const [name, setName] = useState("");
  const nameId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0;

  const handleConfirm = useCallback(() => {
    if (busy || !canSubmit) return;
    onConfirm(trimmedName);
  }, [busy, canSubmit, onConfirm, trimmedName]);

  return (
    <Modal
      unsavedChanges={name !== ""}
      title="New folder"
      description={
        <>
          Create a subfolder in <strong>{parentLabel}</strong>.
        </>
      }
      panelClassName="create-folder-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={inputRef}
      describedById={error ? errorId : undefined}
      footer={
        <ModalActions
          confirmLabel="Create folder"
          busyLabel="Creating..."
          busy={busy}
          confirmDisabled={!canSubmit}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="modal__field">
        <label htmlFor={nameId} className="modal__label">
          Folder name
        </label>
        <input
          ref={inputRef}
          id={nameId}
          type="text"
          className="modal__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Landscapes"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error && (
        <p id={errorId} className="modal__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
