import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetCaptionsDialog } from "./SetCaptionsDialog";

describe("SetCaptionsDialog", () => {
  it("focuses the caption field on open", () => {
    render(<SetCaptionsDialog folderLabel="Photos" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByLabelText("Caption text")).toHaveFocus();
  });

  it("submits the caption text and the overwrite choice", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<SetCaptionsDialog folderLabel="Photos" onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Caption text"), "a scenic mountain landscape");
    await user.click(screen.getByLabelText("Overwrite existing captions"));
    await user.click(screen.getByRole("button", { name: "Set captions" }));

    expect(onConfirm).toHaveBeenCalledWith("a scenic mountain landscape", true);
  });

  it("keeps Enter in the caption field instead of submitting", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<SetCaptionsDialog folderLabel="Photos" onConfirm={onConfirm} onCancel={vi.fn()} />);

    // The field is focused on open, so the first Enter must add a newline.
    await user.keyboard("first{Enter}second");

    expect(screen.getByLabelText("Caption text")).toHaveValue("first\nsecond");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
