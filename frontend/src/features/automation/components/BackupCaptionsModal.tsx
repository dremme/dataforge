import { useCallback } from "react";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { CAPTION_BACKUP_DIR_NAME } from "@/shared/constants";

interface BackupCaptionsModalProps {
  scope: ModalScopeInfo;
  initialSettings: JobSettingsByType["backup_captions"];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BackupCaptionsModal({
  scope,
  busy = false,
  onConfirm,
  onCancel,
}: BackupCaptionsModalProps) {
  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm();
  }, [busy, onConfirm]);

  return (
    <Modal
      scope={scope}
      title="Back up captions?"
      description={
        <>
          Copies the current captions into <strong>{CAPTION_BACKUP_DIR_NAME}</strong>. Existing
          backups are overwritten.
        </>
      }
      panelClassName="backup-captions-modal"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <ModalActions
          confirmLabel="Back up captions"
          busyLabel="Starting..."
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={onCancel}
        />
      }
    />
  );
}
