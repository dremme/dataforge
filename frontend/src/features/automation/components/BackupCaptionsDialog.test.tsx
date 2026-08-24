import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BackupCaptionsDialog } from "./BackupCaptionsDialog";

const OVERWRITE_LABEL = "Overwrite captions already in the backup";

describe("BackupCaptionsDialog", () => {
  it("leaves overwrite off until it is ticked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <BackupCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(OVERWRITE_LABEL)).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Back up captions" }));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("submits the overwrite choice", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <BackupCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(OVERWRITE_LABEL));
    await user.click(screen.getByRole("button", { name: "Back up captions" }));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("does not start while a start is already in flight", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <BackupCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={{}}
        busy
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Starting..." }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
