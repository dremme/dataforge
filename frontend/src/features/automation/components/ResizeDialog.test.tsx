import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResizeDialog } from "./ResizeDialog";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const DEFAULTS: JobSettingsByType["resize"] = emptyAutomationSettings("C:/datasets/photos").resize;

function renderDialog(overrides: Partial<JobSettingsByType["resize"]> = {}) {
  const onConfirm = vi.fn();
  render(
    <ResizeDialog
      scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("ResizeDialog", () => {
  it("submits the remembered budget and grid unchanged", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({ megapixels: 1.5, multiple: 8 });

    await user.click(screen.getByRole("button", { name: "Resize" }));

    expect(onConfirm).toHaveBeenCalledWith(1.5, 8);
  });

  it("submits the values typed into the fields", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.clear(screen.getByLabelText("Megapixels"));
    await user.type(screen.getByLabelText("Megapixels"), "4");
    await user.clear(screen.getByLabelText("Multiple of (px)"));
    await user.type(screen.getByLabelText("Multiple of (px)"), "64");
    await user.click(screen.getByRole("button", { name: "Resize" }));

    expect(onConfirm).toHaveBeenCalledWith(4, 64);
  });

  it("previews what each aspect ratio comes out at, without the old preset dropdowns", () => {
    renderDialog({ megapixels: 2, multiple: 32 });

    const examples = screen.getByLabelText("Example sizes");
    expect(examples).toHaveTextContent("16:91920 × 1088");
    expect(examples).toHaveTextContent("4:31664 × 1248");
    expect(examples).toHaveTextContent("1:11440 × 1440");
    expect(screen.getByLabelText("Megapixels")).not.toHaveAttribute("list");
  });

  it("drops the examples while a field cannot be read", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.clear(screen.getByLabelText("Megapixels"));

    expect(screen.queryByText(/1920 × 1088/)).not.toBeInTheDocument();
  });

  it.each([
    ["Megapixels", "0", "Megapixels must be above 0"],
    ["Multiple of (px)", "", "whole number from 1"],
  ])("refuses %s of %j", async (field, value, message) => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.clear(screen.getByLabelText(field));
    if (value) await user.type(screen.getByLabelText(field), value);
    await user.click(screen.getByRole("button", { name: "Resize" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
  });
});
