import { useCallback, useId, useRef, useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

interface CreateFolderDialogProps {
  parentLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CreateFolderDialog({
  parentLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: CreateFolderDialogProps) {
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
    <Dialog
      title="New folder"
      description={
        <>
          Create a subfolder in <strong>{parentLabel}</strong>.
        </>
      }
      panelClassName="create-folder-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      initialFocusRef={inputRef}
      describedById={error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Create folder"
          busyLabel="Creating..."
          busy={busy}
          confirmDisabled={!canSubmit}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    >
      <div className="dialog__field">
        <label htmlFor={nameId} className="dialog__label">
          Folder name
        </label>
        <input
          ref={inputRef}
          id={nameId}
          type="text"
          className="dialog__input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Landscapes"
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error && (
        <p id={errorId} className="dialog__error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
