import { Dialog, DialogActions } from "./Dialog";

export function DiscardChangesDialog({
  onDiscard,
  onKeepEditing,
  description = "Your unsaved changes will be lost. This cannot be undone.",
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
  description?: string;
}) {
  return (
    <Dialog
      role="alertdialog"
      title="Discard changes?"
      description={description}
      onClose={onKeepEditing}
      onConfirm={onDiscard}
      footer={
        <DialogActions
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          confirmVariant="danger"
          onCancel={onKeepEditing}
        />
      }
    />
  );
}
