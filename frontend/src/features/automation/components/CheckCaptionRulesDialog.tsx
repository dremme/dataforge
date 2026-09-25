import { CAPTION_RULES_FILENAME } from "@/shared/constants";
import { useFolderInstructions } from "@/shared/hooks/useFolderInstructions";
import { iconLoader2 } from "@/shared/icons";
import { Dialog, DialogActions, DialogButton } from "@/shared/ui/Dialog";
import type { DialogScopeInfo } from "@/shared/ui/DialogScope";
import { Icon } from "@/shared/ui/Icon";
import type { InstructionFileResponse } from "@/shared/types";

interface CheckCaptionRulesDialogProps {
  scope: DialogScopeInfo;
  folderPath: string;
  busy?: boolean;
  onConfirm: () => void;
  /** Opens the folder instructions on their caption rules tab. */
  onEditRules: () => void;
  onCancel: () => void;
}

function RulesSource({ rules }: { rules: InstructionFileResponse }) {
  if (rules.has_file) {
    return (
      <>
        Uses this folder's <strong>{CAPTION_RULES_FILENAME}</strong>.
      </>
    );
  }

  if (rules.parent_folder === null) {
    return (
      <>
        No caption rules apply to this folder yet. Add them first; they are saved as{" "}
        <strong>{CAPTION_RULES_FILENAME}</strong> and cover every subfolder too.
      </>
    );
  }

  return (
    <>
      Uses <strong title={rules.parent_folder}>{rules.parent_relative_path}</strong>.
    </>
  );
}

export function CheckCaptionRulesDialog({
  scope,
  folderPath,
  busy = false,
  onConfirm,
  onEditRules,
  onCancel,
}: CheckCaptionRulesDialogProps) {
  const { state, instructions } = useFolderInstructions(folderPath);
  const rules = instructions?.caption_rules ?? null;
  const missing = rules !== null && !rules.has_file && rules.parent_folder === null;
  const handleConfirm = missing ? onEditRules : onConfirm;

  return (
    <Dialog
      scope={scope}
      title="Lint captions?"
      description={
        <>
          Checks each caption against the folder's caption rules. Hits show up as caption issues,
          next to any findings from Verify captions.
        </>
      }
      panelClassName="check-caption-rules-dialog"
      busy={busy}
      onConfirm={rules === null ? undefined : handleConfirm}
      onClose={onCancel}
      footer={
        <>
          {rules !== null && !missing && (
            <span className="check-caption-rules-dialog__edit">
              <DialogButton
                label="Edit rules"
                variant="secondary"
                disabled={busy}
                onClick={onEditRules}
              />
            </span>
          )}
          <DialogActions
            confirmLabel={missing ? "Edit caption rules" : "Lint captions"}
            busyLabel="Starting..."
            busy={busy}
            confirmDisabled={rules === null}
            onConfirm={handleConfirm}
            onCancel={onCancel}
          />
        </>
      }
    >
      {state.status === "loading" && (
        <p className="check-caption-rules-dialog__loading" role="status">
          <Icon icon={iconLoader2} spin className="check-caption-rules-dialog__loading-icon" />
          Loading caption rules...
        </p>
      )}

      {state.status === "error" && (
        <p className="dialog__error" role="alert">
          Could not load the caption rules. {state.message}
        </p>
      )}

      {rules !== null && (
        <p className="dialog__hint check-caption-rules-dialog__source">
          <RulesSource rules={rules} />
        </p>
      )}
    </Dialog>
  );
}
