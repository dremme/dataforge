import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import {
  AcceptAllCandidatesDialog,
  type AcceptAllCandidatesDialogProps,
} from "./AcceptAllCandidatesDialog";

function renderDialog(overrides: Partial<AcceptAllCandidatesDialogProps> = {}) {
  const props: AcceptAllCandidatesDialogProps = {
    open: true,
    scope: {
      itemCount: 12,
      folderLabel: "Photos",
      fromSelection: false,
      note: "3 of them have a staged candidate.",
    },
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<AcceptAllCandidatesDialog {...props} />), props };
}

describe("AcceptAllCandidatesDialog", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("renders nothing while closed", () => {
    renderDialog({ open: false });

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
      scope: { itemCount: 2, folderLabel: "Photos", fromSelection: true },
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

  it("shows progress while accepting", () => {
    renderDialog({ busy: true });

    expect(screen.getByRole("button", { name: "Accepting..." })).toBeDisabled();
  });
});
