import { AutoCaptionDialog } from "./AutoCaptionDialog";
import { SetCaptionsDialog } from "./SetCaptionsDialog";
import { BatchRenameDialog } from "./BatchRenameDialog";
import { TrainLoraDialog } from "./TrainLoraDialog";
import { VerifyCaptionsDialog } from "./VerifyCaptionsDialog";
import { WatermarkDialog } from "./WatermarkDialog";
import type { AutomationDialogsState } from "@/features/automation/types";

type AutomationDialogOverlaysProps = {
  dialogs: AutomationDialogsState;
};

export function AutomationDialogOverlays({ dialogs }: AutomationDialogOverlaysProps) {
  const { setCaptions, autoCaption, verifyCaptions, batchRename, trainLora, watermark } = dialogs;

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

      {autoCaption.open && (
        <AutoCaptionDialog
          folderLabel={autoCaption.folderLabel}
          busy={autoCaption.busy}
          onConfirm={autoCaption.onConfirm}
          onCancel={autoCaption.onCancel}
        />
      )}

      {verifyCaptions.open && verifyCaptions.folderPath && verifyCaptions.initialSettings && (
        <VerifyCaptionsDialog
          folderPath={verifyCaptions.folderPath}
          folderLabel={verifyCaptions.folderLabel}
          initialSettings={verifyCaptions.initialSettings}
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

      {trainLora.open && (
        <TrainLoraDialog
          folderLabel={trainLora.folderLabel}
          itemCount={trainLora.itemCount}
          busy={trainLora.busy}
          onConfirm={trainLora.onConfirm}
          onCancel={trainLora.onCancel}
        />
      )}

      {watermark.open && watermark.initialSettings && (
        <WatermarkDialog
          folderLabel={watermark.folderLabel}
          itemCount={watermark.itemCount}
          initialSettings={watermark.initialSettings}
          busy={watermark.busy}
          onConfirm={watermark.onConfirm}
          onCancel={watermark.onCancel}
        />
      )}
    </>
  );
}
