import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import {
  SettleAllCandidatesDialog,
  type SettleAllCandidatesDialogProps,
} from "./SettleAllCandidatesDialog";

function renderDialog(overrides: Partial<SettleAllCandidatesDialogProps> = {}) {
  const props: SettleAllCandidatesDialogProps = {
    action: "accept",
    scope: {
      itemCount: 12,
      folderLabel: "Photos",
      kind: "folder" as const,
      note: "3 of them have a staged candidate.",
    },
    busy: false,
    keepMetadata: true,
    onKeepMetadataChange: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<SettleAllCandidatesDialog {...props} />), props };
}

describe("SettleAllCandidatesDialog", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("renders nothing while closed", () => {
    renderDialog({ action: null });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("states its scope in the shared row, and that there is no way back", () => {
    renderDialog();

    const dialog = screen.getByRole("alertdialog", { name: "Accept all staged candidates?" });
    expect(dialog).toHaveTextContent("All 12 files in Photos");
    expect(dialog).toHaveTextContent("3 of them have a staged candidate.");
    expect(dialog).toHaveTextContent("No backup is kept, so this cannot be undone.");
    expect(dialog).toHaveTextContent(
      "An unreverted edit is discarded too, making the candidate the new original.",
    );
  });

  it("names the selection when files are selected", () => {
    renderDialog({
      scope: { itemCount: 2, folderLabel: "Photos", kind: "selected" as const },
    });

    const dialog = screen.getByRole("alertdialog", { name: "Accept selected candidates?" });
    expect(dialog).toHaveTextContent("2 selected files in Photos");
  });

  it("confirms and cancels through its own buttons", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms as a primary action, since accepting is what the candidates are for", () => {
    renderDialog();

    expect(screen.getByRole("button", { name: "Accept" })).toHaveClass(
      "confirm-dialog__btn--primary",
    );
  });

  it("offers to keep the original metadata and reports a change", async () => {
    const user = userEvent.setup();
    const { props } = renderDialog();

    const keep = screen.getByRole("checkbox", { name: "Keep original metadata" });
    expect(keep).toBeChecked();
    await user.click(keep);

    expect(props.onKeepMetadataChange).toHaveBeenCalledWith(false);
  });

  it("shows progress while accepting", () => {
    renderDialog({ busy: true });

    expect(screen.getByRole("button", { name: "Accepting..." })).toBeDisabled();
  });

  describe("deleting", () => {
    it("says the source files stay and where the candidates go", () => {
      renderDialog({ action: "delete" });

      const dialog = screen.getByRole("alertdialog", { name: "Delete all staged candidates?" });
      expect(dialog).toHaveTextContent("All 12 files in Photos");
      expect(dialog).toHaveTextContent("3 of them have a staged candidate.");
      expect(dialog).toHaveTextContent("keeps the files they were made from");
      expect(dialog).toHaveTextContent("On Windows, candidates are moved to the Recycle Bin.");
    });

    it("names the selection when files are selected", () => {
      renderDialog({
        action: "delete",
        scope: { itemCount: 2, folderLabel: "Photos", kind: "selected" as const },
      });

      expect(
        screen.getByRole("alertdialog", { name: "Delete selected candidates?" }),
      ).toHaveTextContent("2 selected files in Photos");
    });

    it("confirms as a danger action", async () => {
      const user = userEvent.setup();
      const { props } = renderDialog({ action: "delete" });

      const deleteButton = screen.getByRole("button", { name: "Delete" });
      expect(deleteButton).toHaveClass("confirm-dialog__btn--danger");

      await user.click(deleteButton);
      expect(props.onConfirm).toHaveBeenCalledTimes(1);
    });

    it("has no metadata choice, since nothing is published", () => {
      renderDialog({ action: "delete" });

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("shows progress while deleting", () => {
      renderDialog({ action: "delete", busy: true });

      expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    });
  });
});
