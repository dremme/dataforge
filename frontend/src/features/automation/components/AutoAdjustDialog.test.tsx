import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutoAdjustDialog } from "./AutoAdjustDialog";

const REPLACE_LABEL = "Replace earlier adjustments";
const RESET_LABEL = "Reset all color adjustments to zero";
const SCOPE = { itemCount: 12, folderLabel: "Photos", fromSelection: false };

describe("AutoAdjustDialog", () => {
  it("keeps earlier adjustments unless replacing is ticked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(REPLACE_LABEL)).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Start auto-adjust" }));

    expect(screen.getByLabelText(RESET_LABEL)).not.toBeChecked();
    expect(onConfirm).toHaveBeenCalledWith(false, false);
  });

  it("submits the choice to replace earlier adjustments", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByLabelText(REPLACE_LABEL));
    await user.click(screen.getByRole("button", { name: "Start auto-adjust" }));

    expect(onConfirm).toHaveBeenCalledWith(true, false);
  });

  it("disables replacing and submits only reset while reset is active", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByLabelText(REPLACE_LABEL));
    await user.click(screen.getByLabelText(RESET_LABEL));

    expect(screen.getByLabelText(REPLACE_LABEL)).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Reset color adjustments" }));
    expect(onConfirm).toHaveBeenCalledWith(false, true);

    await user.click(screen.getByLabelText(RESET_LABEL));
    expect(screen.getByLabelText(REPLACE_LABEL)).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Start auto-adjust" }));
    expect(onConfirm).toHaveBeenLastCalledWith(true, false);
  });

  it("does not start while a start is already in flight", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} busy onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(REPLACE_LABEL)).toBeDisabled();
    expect(screen.getByLabelText(RESET_LABEL)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Starting..." }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
