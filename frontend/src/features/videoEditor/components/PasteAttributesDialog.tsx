import { useState } from "react";
import { Dialog, DialogActions } from "@/shared/ui/Dialog";
import { ATTRIBUTE_LABELS, type AttributeGroup } from "@/features/videoEditor/lib/clipboard";

interface PasteAttributesDialogProps {
  /** Names the copied clip the settings come from. */
  donorLabel: string;
  targetCount: number;
  groups: AttributeGroup[];
  onPaste: (groups: AttributeGroup[]) => void;
  onCancel: () => void;
}

/** Chooses which of the copied clip's settings the selected clips take. */
export function PasteAttributesDialog({
  donorLabel,
  targetCount,
  groups,
  onPaste,
  onCancel,
}: PasteAttributesDialogProps) {
  const [chosen, setChosen] = useState<Set<AttributeGroup>>(() => new Set(groups));
  const submit = () => {
    if (chosen.size > 0) onPaste(groups.filter((group) => chosen.has(group)));
  };
  return (
    <Dialog
      title="Paste attributes"
      description={
        <>
          Gives {targetCount === 1 ? "the selected clip" : `the ${targetCount} selected clips`} the
          settings of <strong>{donorLabel}</strong>. A clip keeps any setting it cannot take.
        </>
      }
      role="dialog"
      onConfirm={submit}
      onClose={onCancel}
      footer={
        <DialogActions
          confirmLabel="Paste"
          confirmDisabled={chosen.size === 0}
          onConfirm={submit}
          onCancel={onCancel}
        />
      }
    >
      <fieldset className="dialog__field video-editor__attribute-list">
        <legend className="dialog__label">Settings</legend>
        {groups.map((group) => (
          <label key={group} className="dialog__checkbox">
            <input
              type="checkbox"
              className="dialog__checkbox-input"
              checked={chosen.has(group)}
              onChange={(event) =>
                setChosen((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(group);
                  else next.delete(group);
                  return next;
                })
              }
            />
            <span className="dialog__checkbox-box" aria-hidden="true" />
            <span className="dialog__checkbox-label">{ATTRIBUTE_LABELS[group]}</span>
          </label>
        ))}
      </fieldset>
    </Dialog>
  );
}
