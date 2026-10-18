import { InstructionFileSource } from "@/features/automation/components/InstructionFileSource";
import { instructionApplies } from "@/shared/api/folderInstructions";
import { CAPTION_RULES_FILENAME } from "@/shared/constants";
import { useFolderInstructions } from "@/shared/hooks/useFolderInstructions";
import { Modal, ModalActions } from "@/shared/ui/Modal";
import type { ModalScopeInfo } from "@/shared/ui/ModalScope";

interface CheckCaptionRulesModalProps {
  scope: ModalScopeInfo;
  folderPath: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function CheckCaptionRulesModal({
  scope,
  folderPath,
  busy = false,
  onConfirm,
  onCancel,
}: CheckCaptionRulesModalProps) {
  const { state, instructions } = useFolderInstructions(folderPath);
  const rules = instructions?.caption_rules ?? null;
  const rulesApply = rules !== null && instructionApplies(rules);

  return (
    <Modal
      scope={scope}
      title="Lint captions?"
      description={
        <>
          Checks each caption against the folder's caption rules. Hits show up as caption issues,
          next to any findings from Verify captions.
        </>
      }
      panelClassName="check-caption-rules-modal"
      busy={busy}
      onConfirm={rulesApply ? onConfirm : undefined}
      onClose={onCancel}
      footer={
        <>
          <InstructionFileSource state={state} kind="caption_rules" />
          <ModalActions
            confirmLabel="Lint captions"
            busyLabel="Starting..."
            busy={busy}
            confirmDisabled={!rulesApply}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        </>
      }
    >
      {state.status === "error" && (
        <p className="modal__error" role="alert">
          Could not load the caption rules. {state.message}
        </p>
      )}

      {rules !== null && !rulesApply && (
        <p className="modal__hint check-caption-rules-modal__missing">
          No caption rules apply to this folder yet. Add them in Folder instructions first; they are
          saved as <strong>{CAPTION_RULES_FILENAME}</strong> and cover every subfolder too.
        </p>
      )}
    </Modal>
  );
}
