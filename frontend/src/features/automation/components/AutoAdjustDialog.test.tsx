import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutoAdjustDialog } from "./AutoAdjustDialog";

const REPLACE_LABEL = "Replace earlier adjustments";
const SCOPE = { itemCount: 12, folderLabel: "Photos", fromSelection: false };

describe("AutoAdjustDialog", () => {
  it("keeps earlier adjustments unless replacing is ticked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    expect(screen.getByLabelText(REPLACE_LABEL)).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Start auto-adjust" }));

    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("submits the choice to replace earlier adjustments", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByLabelText(REPLACE_LABEL));
    await user.click(screen.getByRole("button", { name: "Start auto-adjust" }));

    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it("does not start while a start is already in flight", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutoAdjustDialog scope={SCOPE} busy onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Starting..." }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
