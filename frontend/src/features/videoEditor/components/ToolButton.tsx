import type { AppIcon } from "@/shared/icons";
import { classNames } from "@/shared/lib/classNames";
import { ariaKeyShortcuts, type ShortcutDefinition } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";

interface ToolButtonProps {
  icon: AppIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  shortcut?: ShortcutDefinition;
  className?: string;
  /** Shows the label beside the icon, for the actions a toolbar is mostly used for. */
  showLabel?: boolean;
  tooltip?: string;
  tooltipPlacement?: "top" | "bottom";
}

/** An icon button with an accessible name and a tooltip naming it and its key. */
export function ToolButton({
  icon,
  label,
  onClick,
  pressed,
  disabled = false,
  shortcut,
  className,
  showLabel = false,
  tooltip,
  tooltipPlacement = "top",
}: ToolButtonProps) {
  const name = tooltip ?? label;
  const hint = shortcut ? <ShortcutHint shortcut={shortcut}>{name}</ShortcutHint> : name;
  return (
    <Tooltip content={hint} placement={tooltipPlacement}>
      <button
        type="button"
        className={classNames(
          "video-editor__tool",
          showLabel && "video-editor__tool--labelled",
          pressed && "video-editor__tool--pressed",
          className,
        )}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut ? ariaKeyShortcuts(shortcut) : undefined}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon icon={icon} />
        {showLabel && <span>{label}</span>}
      </button>
    </Tooltip>
  );
}
