import type { MediaTransferMode } from "@/features/gallery/api/media";
import { useGallerySelectionContext } from "@/features/gallery/context/GallerySelectionContext";
import { useGlobalShortcut } from "@/shared/hooks/useGlobalShortcut";
import { iconCopy, iconFolderInput, iconLoader2, iconTrash2, type AppIcon } from "@/shared/icons";
import { ariaKeyShortcuts, SHORTCUTS } from "@/shared/lib/shortcuts";
import { Icon } from "@/shared/ui/Icon";
import { ShortcutHint } from "@/shared/ui/ShortcutKeys";
import { Tooltip } from "@/shared/ui/Tooltip";

interface TransferButtonProps {
  mode: MediaTransferMode;
  icon: AppIcon;
  label: string;
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
  totalCount: number;
}

export function GallerySelectionControls({ totalCount }: GallerySelectionControlsProps) {
  const {
    selectionMode,
    visibleSelectedCount,
    enterSelectionMode,
    exitSelectionMode,
    selectAllPaths,
    invertSelectedPaths,
    clearSelectedPaths,
    actions,
  } = useGallerySelectionContext();

  const { busy, deleting, transferring, openDeleteConfirm, startTransfer } = actions;

  // Escape empties a selection first, and only leaves the mode once there is nothing left to lose.
  useGlobalShortcut(
    SHORTCUTS.clearSelection,
    () => {
      if (visibleSelectedCount > 0) clearSelectedPaths();
      else exitSelectionMode();
    },
    { enabled: selectionMode, inEditable: true },
  );

  useGlobalShortcut(SHORTCUTS.selectAll, () => {
    if (!busy) selectAllPaths();
  });

  // Backspace covers Mac keyboards, where the key labelled "delete" reports Backspace.
  // Opening the confirm refuses on its own while busy or with nothing selected.
  useGlobalShortcut(SHORTCUTS.deleteSelection, () => openDeleteConfirm(), {
    enabled: selectionMode,
  });

  if (!selectionMode) {
    return (
      <div className="gallery-controls">
        <button
          type="button"
          className="gallery-controls__btn"
          onClick={enterSelectionMode}
          aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.selectAll)}
        >
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
        disabled={busy || visibleSelectedCount === totalCount}
        aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.selectAll)}
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
        disabled={busy || visibleSelectedCount === 0}
      >
        None
      </button>
      <TransferButton
        mode="copy"
        icon={iconCopy}
        label="Copy selected files"
        transferring={transferring}
        disabled={visibleSelectedCount === 0 || busy}
        onClick={() => startTransfer("copy")}
      />
      <TransferButton
        mode="move"
        icon={iconFolderInput}
        label="Move selected files"
        transferring={transferring}
        disabled={visibleSelectedCount === 0 || busy}
        onClick={() => startTransfer("move")}
      />
      <Tooltip
        content={
          <ShortcutHint shortcut={SHORTCUTS.deleteSelection}>Delete selected files</ShortcutHint>
        }
      >
        <button
          type="button"
          className="gallery-controls__btn gallery-controls__btn--icon gallery-controls__btn--danger"
          onClick={openDeleteConfirm}
          disabled={visibleSelectedCount === 0 || busy}
          aria-busy={deleting || undefined}
          aria-label="Delete selected files"
          aria-keyshortcuts={ariaKeyShortcuts(SHORTCUTS.deleteSelection)}
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
