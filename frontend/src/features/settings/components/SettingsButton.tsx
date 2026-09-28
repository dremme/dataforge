import { iconSettings } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface SettingsButtonProps {
  onOpen: () => void;
}

export function SettingsButton({ onOpen }: SettingsButtonProps) {
  return (
    <Tooltip content="Settings">
      <button
        type="button"
        className="settings-button"
        onClick={onOpen}
        aria-label="Open settings"
        aria-keyshortcuts="Control+Comma Meta+Comma"
      >
        <Icon icon={iconSettings} className="settings-button__icon" />
      </button>
    </Tooltip>
  );
}
