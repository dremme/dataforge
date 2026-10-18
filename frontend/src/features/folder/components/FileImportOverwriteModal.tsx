import { iconAlertTriangle } from "@/shared/icons";
import { Modal, ModalButton } from "@/shared/ui/Modal";

type FileImportOverwriteModalProps = {
  conflicts: string[];
  busy?: boolean;
  title?: string;
  descriptionSuffix?: string;
  skipLabel?: string;
  onReplaceExisting: () => void;
  onCopyNewOnly: () => void;
  onCancel: () => void;
};

export function FileImportOverwriteModal({
  conflicts,
  busy = false,
  title = "Replace existing files?",
  descriptionSuffix = "Choose whether to replace them or import only new files.",
  skipLabel = "Skip existing",
  onReplaceExisting,
  onCopyNewOnly,
  onCancel,
}: FileImportOverwriteModalProps) {
  const conflictPreview =
    conflicts.length <= 3
      ? conflicts.join(", ")
      : `${conflicts.slice(0, 3).join(", ")} and ${conflicts.length - 3} more`;

  return (
    <Modal
      title={title}
      description={
        <>
          {conflicts.length === 1 ? (
            <>
              <strong>{conflictPreview}</strong> already exists in this folder.
            </>
          ) : (
            <>
              <strong>{conflicts.length} files</strong> already exist in this folder, including{" "}
              <strong>{conflictPreview}</strong>.
            </>
          )}
          <br />
          {descriptionSuffix}
        </>
      }
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <ModalButton
            label="Replace existing"
            variant="warning"
            icon={iconAlertTriangle}
            disabled={busy}
            onClick={onReplaceExisting}
          />
          <ModalButton
            label={skipLabel}
            variant="primary"
            disabled={busy}
            onClick={onCopyNewOnly}
          />
        </>
      }
    />
  );
}
