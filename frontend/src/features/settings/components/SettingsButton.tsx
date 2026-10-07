import { iconSettings } from "@/shared/icons";
import { ariaKeyShortcuts, SHORTCUTS } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";

interface SettingsButtonProps {
  onOpen: () => void;
  /** Shows "Settings" beside the icon; the collapsed sidebar rail shows the icon alone. */
  showLabel: boolean;
}

export function SettingsButton({ onOpen, showLabel }: SettingsButtonProps) {
  return (
    <Tooltip content={<ShortcutHint shortcut={SHORTCUTS.settings}>Settings</ShortcutHint>}>
      <button
        type="button"
        className="workspace-button"
        onClick={onOpen}
        aria-label="Open settings"
        aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.settings)}
      >
        <Icon icon={iconSettings} />
        {showLabel && "Settings"}
      </button>
    </Tooltip>
  );
}
