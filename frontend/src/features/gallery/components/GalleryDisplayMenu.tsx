import { DISPLAY_MODE_OPTIONS, displayModeOption } from "@/features/gallery/lib/displayMode";
import { usePopupMenu } from "@/shared/hooks/usePopupMenu";
import { classNames } from "@/shared/lib/classNames";
import type { GalleryDisplayMode } from "@/shared/types";
import { AnchoredLayer } from "@/shared/ui/AnchoredLayer";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface GalleryDisplayMenuProps {
  value: GalleryDisplayMode;
  onChange: (value: GalleryDisplayMode) => void;
}

/** Picks the gallery layout. Sits in the media section header, beside the selection controls. */
export function GalleryDisplayMenu({ value, onChange }: GalleryDisplayMenuProps) {
  const { open, close, menuId, rootRef, panelRef, triggerProps } = usePopupMenu();
  const active = displayModeOption(value);

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
            className={classNames(
              "gallery-display-menu__option",
              option.value === value && "gallery-display-menu__option--active",
            )}
            onClick={() => {
              onChange(option.value);
              close();
            }}
          >
            <Icon icon={option.icon} className="gallery-display-menu__option-icon" />
            <span className="gallery-display-menu__option-label">{option.label}</span>
          </button>
        ))}
      </AnchoredLayer>
    </div>
  );
}
