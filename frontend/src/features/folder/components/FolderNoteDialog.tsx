import { useCallback, useId, useRef, useState } from "react";
import { useSaveFolderNote } from "@/features/folder/hooks/useSaveFolderNote";
import { formatApiError } from "@/shared/api/http";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";

interface FolderNoteDialogProps {
  folderPath: string;
  /** The folder's current note; blank when adding one. */
  initialText: string;
  onClose: () => void;
}

export function FolderNoteDialog({ folderPath, initialText, onClose }: FolderNoteDialogProps) {
  const [text, setText] = useState(initialText);
  const save = useSaveFolderNote();
  const textId = useId();
  const errorId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const adding = initialText === "";
  const busy = save.isPending;
  const canSave = text.trim() !== "" && text.trim() !== initialText;

  const handleConfirm = useCallback(() => {
    if (busy || !canSave) return;
    save.mutate({ path: folderPath, text }, { onSuccess: onClose });
  }, [busy, canSave, folderPath, onClose, save, text]);

  return (
    <Dialog
      title={adding ? "Add note" : "Edit note"}
      description="Shown above this folder's gallery."
      panelClassName="folder-note-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onClose}
      initialFocusRef={textRef}
      describedById={save.error ? errorId : undefined}
      footer={
        <DialogActions
          confirmLabel="Save note"
          busyLabel="Saving..."
          busy={busy}
          confirmDisabled={!canSave}
          onConfirm={handleConfirm}
          onCancel={onClose}
        />
      }
    >
      <div className="dialog__field">
        <label htmlFor={textId} className="dialog__label">
          Note
        </label>
        <textarea
          ref={textRef}
          id={textId}
          className="dialog__input dialog__input--multiline"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={5}
          disabled={busy}
        />
      </div>

      {save.error && (
        <p id={errorId} className="dialog__error" role="alert">
          {formatApiError(save.error)}
        </p>
      )}
    </Dialog>
  );
}
