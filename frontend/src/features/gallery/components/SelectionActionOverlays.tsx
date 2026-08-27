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
  selectedPaths: ReadonlySet<string>;
  selectedCount: number;
  transferPicker: MediaTransferMode | null;
  overwritePrompt: MediaTransferPrompt | null;
  transferring: MediaTransferMode | null;
  deleteConfirmOpen: boolean;
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
  selectedPaths,
  selectedCount,
  transferPicker,
  overwritePrompt,
  transferring,
  deleteConfirmOpen,
  deleting,
  onCloseTransferPicker,
  onSelectDestination,
  onConfirmOverwrite,
  onCloseOverwritePrompt,
  onConfirmDelete,
  onCancelDelete,
}: SelectionActionOverlaysProps) {
  const scope: DialogScopeInfo | undefined = currentFolder
    ? { itemCount: selectedCount, folderLabel: pathBaseName(currentFolder), fromSelection: true }
    : undefined;

  const deleteDescription =
    selectedCount === 1 ? (
      <span>
        This will delete <strong>{pathBaseName(Array.from(selectedPaths)[0])}</strong> and any
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
          title={selectedCount === 1 ? "Delete file?" : "Delete selected files?"}
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
