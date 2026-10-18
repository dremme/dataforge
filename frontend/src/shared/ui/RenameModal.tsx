import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { Modal, ModalActions } from "@/shared/ui/Modal";

interface RenameModalProps {
  title: string;
  description: ReactNode;
  fieldLabel: string;
  /** What the field starts with: a folder's name, or a file's name before its extension. */
  initialName: string;
  busy?: boolean;
  suspended?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function RenameModal({
  title,
  description,
  fieldLabel,
  initialName,
  busy = false,
  suspended = false,
  error = null,
  onConfirm,
  onCancel,
}: RenameModalProps) {
  const [name, setName] = useState(initialName);
  const nameId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && trimmedName !== initialName;

  const handleConfirm = useCallback(() => {
    if (busy || !canSubmit) return;
    onConfirm(trimmedName);
  }, [busy, canSubmit, onConfirm, trimmedName]);

  return (
    <Modal
      unsavedChanges={name !== initialName}
      title={title}
      description={description}
      panelClassName="rename-modal"
      busy={busy}
      suspended={suspended}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={inputRef}
      describedById={error ? errorId : undefined}
      footer={
        <ModalActions
          confirmLabel="Rename"
          busyLabel="Renaming..."
          busy={busy}
          confirmDisabled={!canSubmit}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="modal__field">
        <label htmlFor={nameId} className="modal__label">
          {fieldLabel}
        </label>
        <input
          ref={inputRef}
          id={nameId}
          type="text"
          className="modal__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
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
