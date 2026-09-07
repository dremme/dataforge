import { iconCircleAlert, iconCircleCheck, iconLoader2, iconPencil } from "@/shared/icons";
import type { SaveState } from "@/shared/hooks/useDebouncedSave";
import { classNames } from "@/shared/lib/classNames";
import { Icon } from "@/shared/ui/Icon";

interface CaptionSaveStatusProps {
  state: SaveState;
  error: string | null;
  onRetry: () => void;
}

const STATUS_ICONS = {
  pending: iconPencil,
  saving: iconLoader2,
  saved: iconCircleCheck,
  error: iconCircleAlert,
} as const;

function statusText(state: SaveState, error: string | null): string {
  if (state === "pending") return "Unsaved changes";
  if (state === "saving") return "Saving...";
  if (state === "saved") return "Saved";
  if (state === "error") return error ?? "Save failed";
  return "";
}

export function CaptionSaveStatus({ state, error, onRetry }: CaptionSaveStatusProps) {
  const text = statusText(state, error);
  const icon = state === "idle" ? null : STATUS_ICONS[state];

  return (
    <p
      className={classNames(
        "caption-save-status",
        state !== "idle" && `caption-save-status--${state}`,
      )}
      role="status"
      aria-live="polite"
      aria-label="Caption save state"
    >
      {icon && (
        <Icon
          icon={icon}
          className={classNames(
            "caption-save-status__icon",
            state === "saving" && "caption-save-status__icon--spin",
          )}
        />
      )}
      <span className="caption-save-status__text">{text}</span>
      {state === "error" && (
        <button type="button" className="caption-save-status__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </p>
  );
}
