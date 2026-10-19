import { useDiscardChanges } from "@/shared/hooks/useDiscardChanges";
import { Dialog, type DialogProps } from "./Dialog";
import { DiscardChangesDialog } from "./DiscardChangesDialog";

interface GuardedDialogProps extends Omit<DialogProps, "onCancelAction"> {
  unsavedChanges?: boolean;
}

/** Adds draft protection to the common presentation without guarding its own confirmation. */
export function GuardedDialog({ unsavedChanges = false, ...props }: GuardedDialogProps) {
  const discard = useDiscardChanges({
    unsavedChanges,
    busy: props.busy,
    suspended: props.suspended,
    onNavigationDiscard: props.onClose,
  });
  return (
    <>
      <Dialog
        {...props}
        onClose={() => void discard.request(props.onClose)}
        onCancelAction={discard.request}
        suspended={props.suspended || discard.confirming}
      />
      {discard.promptProps && <DiscardChangesDialog {...discard.promptProps} />}
    </>
  );
}
