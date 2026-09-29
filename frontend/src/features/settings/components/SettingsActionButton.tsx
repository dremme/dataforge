import { iconLoader2, type AppIcon } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";

interface SettingsActionButtonProps {
  label: string;
  icon: AppIcon;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function SettingsActionButton({
  label,
  icon,
  busy = false,
  disabled = false,
  onClick,
}: SettingsActionButtonProps) {
  return (
    <button
      type="button"
      className="settings-action"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <Icon icon={busy ? iconLoader2 : icon} spin={busy} className="settings-action__icon" />
      {label}
    </button>
  );
}
