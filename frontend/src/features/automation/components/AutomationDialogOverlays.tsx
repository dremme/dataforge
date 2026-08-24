import { AutoCaptionDialog } from "./AutoCaptionDialog";
import { BackupCaptionsDialog } from "./BackupCaptionsDialog";
import { SetCaptionsDialog } from "./SetCaptionsDialog";
import { ReplaceCaptionsDialog } from "./ReplaceCaptionsDialog";
import { EditCaptionsDialog } from "./EditCaptionsDialog";
import { FindDuplicatesDialog } from "./FindDuplicatesDialog";
import { BatchRenameDialog } from "./BatchRenameDialog";
import { TrainLoraDialog } from "./TrainLoraDialog";
import { VerifyCaptionsDialog } from "./VerifyCaptionsDialog";
import { WatermarkDialog } from "./WatermarkDialog";
import type { AutomationDialogsState } from "@/features/automation/types";

type AutomationDialogOverlaysProps = {
  dialogs: AutomationDialogsState;
};

export function AutomationDialogOverlays({ dialogs }: AutomationDialogOverlaysProps) {
  const {
    setCaptions,
    replaceCaptions,
    backupCaptions,
    autoCaption,
    verifyCaptions,
    editCaptions,
    findDuplicates,
    batchRename,
    trainLora,
    watermark,
  } = dialogs;

  return (
    <>
      {setCaptions.open && setCaptions.initialSettings && (
        <SetCaptionsDialog
          scope={setCaptions.scope}
          initialSettings={setCaptions.initialSettings}
          busy={setCaptions.busy}
          onConfirm={setCaptions.onConfirm}
          onCancel={setCaptions.onCancel}
        />
      )}

      {replaceCaptions.open && replaceCaptions.folderPath && replaceCaptions.initialSettings && (
        <ReplaceCaptionsDialog
          scope={replaceCaptions.scope}
          initialSettings={replaceCaptions.initialSettings}
          folderPath={replaceCaptions.folderPath}
          selectedPaths={replaceCaptions.selectedPaths}
          busy={replaceCaptions.busy}
          onConfirm={replaceCaptions.onConfirm}
          onCancel={replaceCaptions.onCancel}
        />
      )}

      {backupCaptions.open && backupCaptions.initialSettings && (
        <BackupCaptionsDialog
          scope={backupCaptions.scope}
          initialSettings={backupCaptions.initialSettings}
          busy={backupCaptions.busy}
          onConfirm={backupCaptions.onConfirm}
          onCancel={backupCaptions.onCancel}
        />
      )}

      {autoCaption.open && autoCaption.initialSettings && (
        <AutoCaptionDialog
          scope={autoCaption.scope}
          initialSettings={autoCaption.initialSettings}
          busy={autoCaption.busy}
          onConfirm={autoCaption.onConfirm}
          onCancel={autoCaption.onCancel}
        />
      )}

      {verifyCaptions.open && verifyCaptions.initialSettings && (
        <VerifyCaptionsDialog
          scope={verifyCaptions.scope}
          initialSettings={verifyCaptions.initialSettings}
          busy={verifyCaptions.busy}
          onConfirm={verifyCaptions.onConfirm}
          onCancel={verifyCaptions.onCancel}
        />
      )}

      {editCaptions.open && editCaptions.initialSettings && (
        <EditCaptionsDialog
          scope={editCaptions.scope}
          initialSettings={editCaptions.initialSettings}
          busy={editCaptions.busy}
          onConfirm={editCaptions.onConfirm}
          onCancel={editCaptions.onCancel}
        />
      )}

      {findDuplicates.open && findDuplicates.initialSettings && (
        <FindDuplicatesDialog
          scope={findDuplicates.scope}
          initialSettings={findDuplicates.initialSettings}
          busy={findDuplicates.busy}
          onConfirm={findDuplicates.onConfirm}
          onCancel={findDuplicates.onCancel}
        />
      )}

      {batchRename.open && batchRename.initialSettings && (
        <BatchRenameDialog
          scope={batchRename.scope}
          initialSettings={batchRename.initialSettings}
          busy={batchRename.busy}
          onConfirm={batchRename.onConfirm}
          onCancel={batchRename.onCancel}
        />
      )}

      {trainLora.open && trainLora.initialSettings && (
        <TrainLoraDialog
          scope={trainLora.scope}
          initialSettings={trainLora.initialSettings}
          busy={trainLora.busy}
          onConfirm={trainLora.onConfirm}
          onCancel={trainLora.onCancel}
        />
      )}

      {watermark.open && watermark.initialSettings && (
        <WatermarkDialog
          scope={watermark.scope}
          initialSettings={watermark.initialSettings}
          busy={watermark.busy}
          onConfirm={watermark.onConfirm}
          onCancel={watermark.onCancel}
        />
      )}
    </>
  );
}
