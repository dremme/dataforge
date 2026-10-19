import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DialogActions } from "./Dialog";
import { GuardedDialog } from "./GuardedDialog";

function renderDialog(overrides: Partial<Parameters<typeof GuardedDialog>[0]> = {}) {
  const onClose = vi.fn<() => void>();
  const onConfirm = vi.fn<() => void>();
  render(
    <GuardedDialog
      title="Edit settings"
      onClose={onClose}
      onConfirm={onConfirm}
      footer={<DialogActions confirmLabel="Save" onCancel={onClose} />}
      {...overrides}
    />,
  );
  return { onClose, onConfirm };
}

describe("GuardedDialog", () => {
  it.each(["Cancel", "Close", "Escape", "Backdrop"])(
    "asks before %s discards changes and can keep editing",
    async (exit) => {
      const user = userEvent.setup();
      const { onClose, onConfirm } = renderDialog({ unsavedChanges: true });
      const dismiss = async () => {
        if (exit === "Escape") await user.keyboard("{Escape}");
        else
          await user.click(
            exit === "Backdrop"
              ? screen.getByLabelText("Close dialog")
              : screen.getByRole("button", { name: exit }),
          );
      };

      await dismiss();
      const confirmation = await screen.findByRole("alertdialog", { name: "Discard changes?" });
      expect(onClose).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
      await user.click(within(confirmation).getByRole("button", { name: "Keep editing" }));
      expect(
        screen.queryByRole("alertdialog", { name: "Discard changes?" }),
      ).not.toBeInTheDocument();

      await dismiss();
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );
});
