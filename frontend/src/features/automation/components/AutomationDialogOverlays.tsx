import { AutoCaptionDialog } from "./AutoCaptionDialog";
import { BodyPartsDialog } from "./BodyPartsDialog";
import { SetCaptionsDialog } from "./SetCaptionsDialog";
import { BatchRenameDialog } from "./BatchRenameDialog";
import { VerifyCaptionsDialog } from "./VerifyCaptionsDialog";
import type { AutomationDialogsState } from "@/features/automation/types";

type AutomationDialogOverlaysProps = {
  dialogs: AutomationDialogsState;
};

export function AutomationDialogOverlays({ dialogs }: AutomationDialogOverlaysProps) {
  const { setCaptions, bodyParts, autoCaption, verifyCaptions, batchRename } = dialogs;

  return (
    <>
      {setCaptions.open && (
        <SetCaptionsDialog
          folderLabel={setCaptions.folderLabel}
          busy={setCaptions.busy}
          onConfirm={setCaptions.onConfirm}
          onCancel={setCaptions.onCancel}
        />
      )}

      {bodyParts.open && (
        <BodyPartsDialog
          folderLabel={bodyParts.folderLabel}
          busy={bodyParts.busy}
          onConfirm={bodyParts.onConfirm}
          onCancel={bodyParts.onCancel}
        />
      )}

      {autoCaption.open && (
        <AutoCaptionDialog
          folderLabel={autoCaption.folderLabel}
          busy={autoCaption.busy}
          onConfirm={autoCaption.onConfirm}
          onCancel={autoCaption.onCancel}
        />
      )}

      {verifyCaptions.open && (
        <VerifyCaptionsDialog
          folderLabel={verifyCaptions.folderLabel}
          busy={verifyCaptions.busy}
          onConfirm={verifyCaptions.onConfirm}
          onCancel={verifyCaptions.onCancel}
        />
      )}

      {batchRename.open && (
        <BatchRenameDialog
          folderLabel={batchRename.folderLabel}
          itemCount={batchRename.itemCount}
          busy={batchRename.busy}
          onConfirm={batchRename.onConfirm}
          onCancel={batchRename.onCancel}
        />
      )}
    </>
  );
}
