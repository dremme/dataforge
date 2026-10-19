import { useCallback } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { CAPTION_BACKUP_DIR_NAME } from "@/shared/constants";

interface BackupCaptionsDialogProps {
  scope: DialogScopeInfo;
  initialSettings: JobSettingsByType["backup_captions"];
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BackupCaptionsDialog({
  scope,
  busy = false,
  onConfirm,
  onCancel,
}: BackupCaptionsDialogProps) {
  const handleConfirm = useCallback(() => {
    if (busy) return;
    onConfirm();
  }, [busy, onConfirm]);

  return (
    <Dialog
      scope={scope}
      title="Back up captions?"
      description={
        <>
          Copies the current captions into <strong>{CAPTION_BACKUP_DIR_NAME}</strong>. Existing
          backups are overwritten.
        </>
      }
      panelClassName="backup-captions-dialog"
      busy={busy}
      onConfirm={handleConfirm}
      onClose={onCancel}
      footer={
        <DialogActions
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
