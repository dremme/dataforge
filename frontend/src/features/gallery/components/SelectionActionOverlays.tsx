import type { MediaTransferMode } from "@/features/gallery/api/media";
import type { MediaTransferPrompt } from "@/features/gallery/hooks/useMediaTransfer";
import { pathBaseName } from "@/features/gallery/lib/mediaActionMessages";
import { FileImportOverwriteDialog } from "@/features/folder/components/FileImportOverwriteDialog";
import { TransferMediaDialog } from "@/features/gallery/components/TransferMediaDialog";
import { CAPTION_SIDECAR_EXTENSION_LIST } from "@/shared/lib/captionSidecar";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";

export interface SelectionActionOverlaysProps {
  currentFolder: string | undefined;
  selectedCount: number;
  transferPicker: MediaTransferMode | null;
  overwritePrompt: MediaTransferPrompt | null;
  transferring: MediaTransferMode | null;
  deleteConfirmOpen: boolean;
  /** The selection, or the one file a card's own Delete names. */
  deletePaths: ReadonlySet<string>;
  deletesSelection: boolean;
  deleting: boolean;
  onCloseTransferPicker: () => void;
  onSelectDestination: (mode: MediaTransferMode, destination: string) => void;
  onConfirmOverwrite: (overwrite: boolean) => void;
  onCloseOverwritePrompt: () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
}

export function SelectionActionOverlays({
  currentFolder,
  selectedCount,
  transferPicker,
  overwritePrompt,
  transferring,
  deleteConfirmOpen,
  deletePaths,
  deletesSelection,
  deleting,
  onCloseTransferPicker,
  onSelectDestination,
  onConfirmOverwrite,
  onCloseOverwritePrompt,
  onConfirmDelete,
  onCancelDelete,
}: SelectionActionOverlaysProps) {
  // A card's own Delete names its file in the description; a selection scope would misstate it.
  const scope: DialogScopeInfo | undefined =
    currentFolder && deletesSelection
      ? {
          itemCount: selectedCount,
          folderLabel: pathBaseName(currentFolder),
          kind: "selected" as const,
        }
      : undefined;

  const deleteCount = deletePaths.size;
  const deleteDescription =
    deleteCount === 1 ? (
      <span>
        This will delete <strong>{pathBaseName(Array.from(deletePaths)[0])}</strong> and any
        matching caption sidecars ({CAPTION_SIDECAR_EXTENSION_LIST}). On Windows, files are moved to
        the Recycle Bin.
      </span>
    ) : (
      <span>
        This also deletes any matching caption sidecars ({CAPTION_SIDECAR_EXTENSION_LIST}). On
        Windows, files are moved to the Recycle Bin.
      </span>
    );

  return (
    <>
      {transferPicker && currentFolder && (
        <TransferMediaDialog
          mode={transferPicker}
          currentFolder={currentFolder}
          scope={scope}
          selectedCount={selectedCount}
          busy={transferring !== null}
          onClose={onCloseTransferPicker}
          onSelectDestination={(path) => {
            onSelectDestination(transferPicker, path);
          }}
        />
      )}

      {overwritePrompt && (
        <FileImportOverwriteDialog
          conflicts={overwritePrompt.conflicts}
          busy={transferring !== null}
          descriptionSuffix={
            overwritePrompt.mode === "move"
              ? "Choose whether to replace them or move only new files."
              : "Choose whether to replace them or copy only new files."
          }
          onReplaceExisting={() => onConfirmOverwrite(true)}
          onCopyNewOnly={() => onConfirmOverwrite(false)}
          onCancel={onCloseOverwritePrompt}
        />
      )}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title={deleteCount === 1 ? "Delete file?" : "Delete selected files?"}
          scope={scope}
          description={deleteDescription}
          confirmLabel={deleting ? "Deleting..." : "Delete"}
          confirmVariant="danger"
          busy={deleting}
          onConfirm={() => {
            void onConfirmDelete();
          }}
          onCancel={onCancelDelete}
        />
      )}
    </>
  );
}
