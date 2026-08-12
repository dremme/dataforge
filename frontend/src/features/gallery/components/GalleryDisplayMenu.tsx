import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DISPLAY_MODE_OPTIONS, displayModeOption } from "@/features/gallery/lib/displayMode";
import { useEscapeKey } from "@/shared/hooks/useEscapeKey";
import { classNames } from "@/shared/lib/classNames";
import type { GalleryDisplayMode } from "@/shared/types";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface GalleryDisplayMenuProps {
  value: GalleryDisplayMode;
  onChange: (value: GalleryDisplayMode) => void;
}

/** Picks the gallery layout. Sits in the media section header, beside the selection controls. */
export function GalleryDisplayMenu({ value, onChange }: GalleryDisplayMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEscapeKey(close, open);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [close, open]);

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
          onClick={() => setOpen((current) => !current)}
          aria-label="Display mode"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
        >
          <Icon icon={active.icon} className="gallery-display-menu__trigger-icon" />
        </button>
      </Tooltip>

      {open && (
        <div
          id={menuId}
          className="gallery-display-menu__panel"
          role="menu"
          aria-label="Display mode"
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
        </div>
      )}
    </div>
  );
}
