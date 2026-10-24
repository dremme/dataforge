import { DISPLAY_MODE_OPTIONS, displayModeOption } from "@/features/gallery/lib/displayMode";
import { useGlobalShortcut } from "@/shared/hooks/useGlobalShortcut";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { classNames } from "@/shared/lib/classNames";
import { ariaKeyShortcuts, SHORTCUTS } from "@/shared/lib/shortcuts";
import type { GalleryDisplayMode } from "@/shared/types";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutKeys } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";

interface GalleryDisplayMenuProps {
  value: GalleryDisplayMode;
  onChange: (value: GalleryDisplayMode) => void;
}

export function GalleryDisplayMenu({ value, onChange }: GalleryDisplayMenuProps) {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const active = displayModeOption(value);
  const choose = (mode: GalleryDisplayMode) => {
    if (mode !== value) onChange(mode);
  };

  useGlobalShortcut(SHORTCUTS.displayLarge, () => choose("large"));
  useGlobalShortcut(SHORTCUTS.displaySmall, () => choose("small"));
  useGlobalShortcut(SHORTCUTS.displayList, () => choose("list"));

  return (
    <div
      ref={rootRef}
      className={classNames("gallery-display-menu", open && "gallery-display-menu--open")}
    >
      <Tooltip content={`Display mode: ${active.label}`}>
        <button
          type="button"
          className="gallery-display-menu__trigger"
          aria-label="Display mode"
          {...triggerProps}
        >
          <Icon icon={active.icon} className="gallery-display-menu__trigger-icon" />
        </button>
      </Tooltip>

      <AnchoredLayer
        anchorRef={rootRef}
        floatingRef={panelRef}
        open={open}
        id={menuId}
        className="gallery-display-menu__panel"
        role="menu"
        label="Display mode"
      >
        {DISPLAY_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={option.value === value}
            aria-label={option.ariaLabel}
            aria-keyshortcuts={ariaKeyShortcuts(option.shortcut)}
            className={classNames(
              "gallery-display-menu__option",
              option.value === value && "gallery-display-menu__option--active",
            )}
            onClick={() => {
              choose(option.value);
              close();
            }}
          >
            <Icon icon={option.icon} className="gallery-display-menu__option-icon" />
            <span className="gallery-display-menu__option-label">{option.label}</span>
            <ShortcutKeys shortcut={option.shortcut} />
          </button>
        ))}
      </AnchoredLayer>
    </div>
  );
}
