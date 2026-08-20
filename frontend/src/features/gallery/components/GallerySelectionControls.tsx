import { useEffect } from "react";
import type { MediaTransferMode } from "@/features/gallery/api/media";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { getScrollLockDepth } from "@/shared/hooks/useScrollLock";
import { iconCopy, iconFolderInput, iconLoader2, iconTrash2, type AppIcon } from "@/shared/icons";
import { Icon } from "@/shared/ui/Icon";
import { Tooltip } from "@/shared/ui/Tooltip";

interface TransferButtonProps {
  mode: MediaTransferMode;
  icon: AppIcon;
  /** Names the action for the tooltip and, since the button is icon-only, for
   *  its accessible name too. The spinner is what reports the busy state. */
  label: string;
  /** Which transfer is running, so only that button shows its spinner. */
  transferring: MediaTransferMode | null;
  disabled: boolean;
  onClick: () => void;
}

function TransferButton({
  mode,
  icon,
  label,
  transferring,
  disabled,
  onClick,
}: TransferButtonProps) {
  const active = transferring === mode;

  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="gallery-controls__btn gallery-controls__btn--icon"
        onClick={onClick}
        disabled={disabled}
        aria-busy={active || undefined}
        aria-label={label}
      >
        <Icon
          icon={active ? iconLoader2 : icon}
          spin={active}
          className="gallery-controls__btn-icon"
        />
      </button>
    </Tooltip>
  );
}

interface GallerySelectionControlsProps {
  /** Items currently visible under the active filters, for "select all". */
  totalCount: number;
}

export function GallerySelectionControls({ totalCount }: GallerySelectionControlsProps) {
  const {
    selectionMode,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    selectAllPaths,
    invertSelectedPaths,
    clearSelectedPaths,
    actions,
  } = useGallerySelectionContext();

  const { busy, deleting, transferring, openDeleteConfirm, startTransfer } = actions;

  // Escape unwinds selection mode one step at a time: it empties a selection
  // first, and only leaves the mode once there is nothing left to lose. A single
  // press still exits when nothing is selected, so the extra press is only ever
  // charged to the case where it protects work.
  useEffect(() => {
    if (!selectionMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (getScrollLockDepth() > 0) {
        return;
      }

      event.preventDefault();
      if (selectedCount > 0) {
        clearSelectedPaths();
        return;
      }
      exitSelectionMode();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearSelectedPaths, exitSelectionMode, selectedCount, selectionMode]);

  if (!selectionMode) {
    return (
      <div className="gallery-controls">
        <button type="button" className="gallery-controls__btn" onClick={enterSelectionMode}>
          Select
        </button>
      </div>
    );
  }

  return (
    <div className="gallery-controls">
      <button
        type="button"
        className="gallery-controls__btn gallery-controls__btn--accent"
        onClick={exitSelectionMode}
        disabled={busy}
        aria-label="Exit selection mode"
      >
        Done
      </button>
      <button
        type="button"
        className="gallery-controls__btn"
        onClick={selectAllPaths}
        disabled={busy || selectedCount === totalCount}
      >
        All
      </button>
      <button
        type="button"
        className="gallery-controls__btn"
        onClick={invertSelectedPaths}
        disabled={busy || totalCount === 0}
      >
        Invert
      </button>
      <button
        type="button"
        className="gallery-controls__btn"
        onClick={clearSelectedPaths}
        disabled={busy || selectedCount === 0}
      >
        None
      </button>
      <TransferButton
        mode="copy"
        icon={iconCopy}
        label="Copy selected files"
        transferring={transferring}
        disabled={selectedCount === 0 || busy}
        onClick={() => startTransfer("copy")}
      />
      <TransferButton
        mode="move"
        icon={iconFolderInput}
        label="Move selected files"
        transferring={transferring}
        disabled={selectedCount === 0 || busy}
        onClick={() => startTransfer("move")}
      />
      <Tooltip content="Delete selected files">
        <button
          type="button"
          className="gallery-controls__btn gallery-controls__btn--icon gallery-controls__btn--danger"
          onClick={openDeleteConfirm}
          disabled={selectedCount === 0 || busy}
          aria-busy={deleting || undefined}
          aria-label="Delete selected files"
        >
          <Icon
            icon={deleting ? iconLoader2 : iconTrash2}
            spin={deleting}
            className="gallery-controls__btn-icon"
          />
        </button>
      </Tooltip>
    </div>
  );
}
