import { useState } from "react";
import { formatApiError } from "@/shared/api/http";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";

interface DeleteVideoProjectDialogProps {
  name: string;
  /** Deletes the draft; a rejection stays in the dialog so it can be retried. */
  onDelete: () => Promise<void>;
  onClose: () => void;
}

export function DeleteVideoProjectDialog({
  name,
  onDelete,
  onClose,
}: DeleteVideoProjectDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    setBusy(true);
    setError(null);
    onDelete().catch((caught: unknown) => {
      setError(formatApiError(caught));
      setBusy(false);
    });
  };

  return (
    <ConfirmDialog
      title="Delete this video project?"
      description={
        <>
          Deletes the project <strong>{name}</strong> and closes the editor. Its source media and
          any videos exported from it stay where they are.
          {error && <span className="dialog__error">{error}</span>}
        </>
      }
      confirmLabel="Delete project"
      confirmVariant="danger"
      busy={busy}
      onCancel={onClose}
      onConfirm={confirm}
    />
  );
}
