import { AutoAdjustModal } from "./AutoAdjustModal";
import { AutoCaptionModal } from "./AutoCaptionModal";
import { BackupCaptionsModal } from "./BackupCaptionsModal";
import { SetCaptionsModal } from "./SetCaptionsModal";
import { ReplaceCaptionsModal } from "./ReplaceCaptionsModal";
import { EditCaptionsModal } from "./EditCaptionsModal";
import { FindDuplicatesModal } from "./FindDuplicatesModal";
import { BatchRenameModal } from "./BatchRenameModal";
import { CheckCaptionRulesModal } from "./CheckCaptionRulesModal";
import { ComfyProcessModal } from "./ComfyProcessModal";
import { TrainLoraModal } from "./TrainLoraModal";
import { VerifyCaptionsModal } from "./VerifyCaptionsModal";
import { ResizeModal } from "./ResizeModal";
import { WatermarkModal } from "./WatermarkModal";
import type { AutomationModalsState } from "@/features/automation/types";

type AutomationModalOverlaysProps = {
  modals: AutomationModalsState;
};

export function AutomationModalOverlays({ modals }: AutomationModalOverlaysProps) {
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
    resize,
    comfyProcess,
    autoAdjust,
    checkCaptionRules,
  } = modals;

  return (
    <>
      {setCaptions.open && setCaptions.initialSettings && (
        <SetCaptionsModal
          scope={setCaptions.scope}
          initialSettings={setCaptions.initialSettings}
          busy={setCaptions.busy}
          onConfirm={setCaptions.onConfirm}
          onCancel={setCaptions.onCancel}
        />
      )}

      {replaceCaptions.open && replaceCaptions.folderPath && replaceCaptions.initialSettings && (
        <ReplaceCaptionsModal
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
        <BackupCaptionsModal
          scope={backupCaptions.scope}
          initialSettings={backupCaptions.initialSettings}
          busy={backupCaptions.busy}
          onConfirm={backupCaptions.onConfirm}
          onCancel={backupCaptions.onCancel}
        />
      )}

      {autoCaption.open && autoCaption.folderPath && autoCaption.initialSettings && (
        <AutoCaptionModal
          scope={autoCaption.scope}
          folderPath={autoCaption.folderPath}
          initialSettings={autoCaption.initialSettings}
          busy={autoCaption.busy}
          onConfirm={autoCaption.onConfirm}
          onCancel={autoCaption.onCancel}
        />
      )}

      {verifyCaptions.open && verifyCaptions.initialSettings && (
        <VerifyCaptionsModal
          scope={verifyCaptions.scope}
          initialSettings={verifyCaptions.initialSettings}
          busy={verifyCaptions.busy}
          onConfirm={verifyCaptions.onConfirm}
          onCancel={verifyCaptions.onCancel}
        />
      )}

      {editCaptions.open && editCaptions.initialSettings && (
        <EditCaptionsModal
          scope={editCaptions.scope}
          folderPath={editCaptions.folderPath}
          selectedPaths={editCaptions.selectedPaths}
          initialSettings={editCaptions.initialSettings}
          busy={editCaptions.busy}
          onConfirm={editCaptions.onConfirm}
          onCancel={editCaptions.onCancel}
        />
      )}

      {findDuplicates.open && findDuplicates.initialSettings && (
        <FindDuplicatesModal
          scope={findDuplicates.scope}
          initialSettings={findDuplicates.initialSettings}
          busy={findDuplicates.busy}
          onConfirm={findDuplicates.onConfirm}
          onCancel={findDuplicates.onCancel}
        />
      )}

      {batchRename.open && batchRename.initialSettings && (
        <BatchRenameModal
          scope={batchRename.scope}
          initialSettings={batchRename.initialSettings}
          busy={batchRename.busy}
          onConfirm={batchRename.onConfirm}
          onCancel={batchRename.onCancel}
        />
      )}

      {trainLora.open && trainLora.initialSettings && (
        <TrainLoraModal
          scope={trainLora.scope}
          initialSettings={trainLora.initialSettings}
          busy={trainLora.busy}
          onConfirm={trainLora.onConfirm}
          onCancel={trainLora.onCancel}
        />
      )}

      {watermark.open && watermark.initialSettings && (
        <WatermarkModal
          scope={watermark.scope}
          initialSettings={watermark.initialSettings}
          busy={watermark.busy}
          onConfirm={watermark.onConfirm}
          onCancel={watermark.onCancel}
        />
      )}

      {comfyProcess.open && comfyProcess.initialSettings && (
        <ComfyProcessModal
          scope={comfyProcess.scope}
          initialSettings={comfyProcess.initialSettings}
          busy={comfyProcess.busy}
          onConfirm={comfyProcess.onConfirm}
          onCancel={comfyProcess.onCancel}
        />
      )}

      {resize.open && resize.initialSettings && (
        <ResizeModal
          scope={resize.scope}
          initialSettings={resize.initialSettings}
          busy={resize.busy}
          onConfirm={resize.onConfirm}
          onCancel={resize.onCancel}
        />
      )}

      {autoAdjust.open && (
        <AutoAdjustModal
          scope={autoAdjust.scope}
          busy={autoAdjust.busy}
          onConfirm={autoAdjust.onConfirm}
          onCancel={autoAdjust.onCancel}
        />
      )}

      {checkCaptionRules.open && (
        <CheckCaptionRulesModal
          scope={checkCaptionRules.scope}
          folderPath={checkCaptionRules.folderPath}
          busy={checkCaptionRules.busy}
          onConfirm={checkCaptionRules.onConfirm}
          onCancel={checkCaptionRules.onCancel}
        />
      )}
    </>
  );
}
