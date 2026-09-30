import { iconSettings } from "@/shared/icons";
import { ariaKeyShortcuts, SHORTCUTS } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";

interface SettingsButtonProps {
  onOpen: () => void;
}

export function SettingsButton({ onOpen }: SettingsButtonProps) {
  return (
    <Tooltip content={<ShortcutHint shortcut={SHORTCUTS.settings}>Settings</ShortcutHint>}>
      <button
        type="button"
        className="settings-button"
        onClick={onOpen}
        aria-label="Open settings"
        aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.settings)}
      >
        <Icon icon={iconSettings} className="settings-button__icon" />
      </button>
    </Tooltip>
  );
}
