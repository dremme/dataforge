import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import {
  SettleAllCandidatesModal,
  type SettleAllCandidatesModalProps,
} from "./SettleAllCandidatesModal";

function renderModal(overrides: Partial<SettleAllCandidatesModalProps> = {}) {
  const props: SettleAllCandidatesModalProps = {
    action: "accept",
    scope: {
      itemCount: 12,
      folderLabel: "Photos",
      kind: "folder" as const,
      note: "3 of them have a staged candidate.",
    },
    busy: false,
    keepMetadata: true,
    onKeepMetadataChange: vi.fn<(keep: boolean) => void>(),
    onConfirm: vi.fn<() => void>(),
    onCancel: vi.fn<() => void>(),
    ...overrides,
  };
  return { ...render(<SettleAllCandidatesModal {...props} />), props };
}

describe("SettleAllCandidatesModal", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("renders nothing while closed", () => {
    renderModal({ action: null });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("states its scope in the shared row, and that there is no way back", () => {
    renderModal();

    const modal = screen.getByRole("alertdialog", { name: "Accept all staged candidates?" });
    expect(modal).toHaveTextContent("All 12 files in Photos");
    expect(modal).toHaveTextContent("3 of them have a staged candidate.");
    expect(modal).toHaveTextContent("No backup is kept, so this cannot be undone.");
    expect(modal).toHaveTextContent(
      "An unreverted edit is discarded too, making the candidate the new original.",
    );
  });

  it("names the selection when files are selected", () => {
    renderModal({
      scope: { itemCount: 2, folderLabel: "Photos", kind: "selected" as const },
    });

    const modal = screen.getByRole("alertdialog", { name: "Accept selected candidates?" });
    expect(modal).toHaveTextContent("2 selected files in Photos");
  });

  it("confirms and cancels through its own buttons", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("confirms as a primary action, since accepting is what the candidates are for", () => {
    renderModal();

    expect(screen.getByRole("button", { name: "Accept" })).toHaveClass(
      "confirm-modal__btn--primary",
    );
  });

  it("offers to keep the original metadata and reports a change", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    const keep = screen.getByRole("checkbox", { name: "Keep original metadata" });
    expect(keep).toBeChecked();
    await user.click(keep);

    expect(props.onKeepMetadataChange).toHaveBeenCalledWith(false);
  });

  it("shows progress while accepting", () => {
    renderModal({ busy: true });

    expect(screen.getByRole("button", { name: "Accepting..." })).toBeDisabled();
  });

  describe("deleting", () => {
    it("says the source files stay and where the candidates go", () => {
      renderModal({ action: "delete" });

      const modal = screen.getByRole("alertdialog", { name: "Delete all staged candidates?" });
      expect(modal).toHaveTextContent("All 12 files in Photos");
      expect(modal).toHaveTextContent("3 of them have a staged candidate.");
      expect(modal).toHaveTextContent("keeps the files they were made from");
      expect(modal).toHaveTextContent("On Windows, candidates are moved to the Recycle Bin.");
    });

    it("names the selection when files are selected", () => {
      renderModal({
        action: "delete",
        scope: { itemCount: 2, folderLabel: "Photos", kind: "selected" as const },
      });

      expect(
        screen.getByRole("alertdialog", { name: "Delete selected candidates?" }),
      ).toHaveTextContent("2 selected files in Photos");
    });

    it("confirms as a danger action", async () => {
      const user = userEvent.setup();
      const { props } = renderModal({ action: "delete" });

      const deleteButton = screen.getByRole("button", { name: "Delete" });
      expect(deleteButton).toHaveClass("confirm-modal__btn--danger");

      await user.click(deleteButton);
      expect(props.onConfirm).toHaveBeenCalledTimes(1);
    });

    it("has no metadata choice, since nothing is published", () => {
      renderModal({ action: "delete" });

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("shows progress while deleting", () => {
      renderModal({ action: "delete", busy: true });

      expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    });
  });
});
