import { useId } from "react";
import { CAPTION_BACKUP_DIR_NAME } from "@/shared/constants";

interface CaptionBackupOptionProps {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

export function CaptionBackupOption({ checked, disabled, onChange }: CaptionBackupOptionProps) {
  const hintId = useId();

  return (
    <div>
      <label className="dialog__checkbox">
        <input
          type="checkbox"
          className="dialog__checkbox-input"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          aria-describedby={hintId}
        />
        <span className="dialog__checkbox-box" aria-hidden="true" />
        <span className="dialog__checkbox-label">Back up captions first</span>
      </label>
      <p id={hintId} className="dialog__hint">
        Before each edit, originals go to <strong>{CAPTION_BACKUP_DIR_NAME}</strong> for Restore
        captions. Existing backups are overwritten.
      </p>
    </div>
  );
}
