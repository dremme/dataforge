import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JobSettingsByType } from "@/features/automation/preferences/automationPreferences";
import { MAX_WATERMARK_TEXT_LENGTH, WatermarkDialog } from "./WatermarkDialog";

const DEFAULTS: JobSettingsByType["watermark"] = {
  text: "",
  size: "medium",
  opacity: 50,
  position: "bottom",
  strip_metadata: false,
};

function renderDialog(
  overrides: Partial<JobSettingsByType["watermark"]> = {},
  onConfirm = vi.fn(),
) {
  render(
    <WatermarkDialog
      scope={{ itemCount: 3, folderLabel: "Photos", fromSelection: false }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );

  return onConfirm;
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Add watermark" }));
}

describe("WatermarkDialog", () => {
  it("starts from the stored settings", () => {
    renderDialog({ text: "Sample Studio", size: "large", opacity: 75, position: "top" });

    expect(screen.getByLabelText("Watermark text")).toHaveValue("Sample Studio");
    expect(screen.getByRole("radio", { name: "Large" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "75%" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Top/ })).toBeChecked();
  });

  it("defaults to medium at half opacity in the bottom right", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: "Medium" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "50%" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Bottom/ })).toBeChecked();
  });

  it("submits the text with the chosen size, opacity, and position", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "  Sample Studio  ");
    await user.click(screen.getByRole("radio", { name: "Large" }));
    await user.click(screen.getByRole("radio", { name: "25%" }));
    await user.click(screen.getByRole("radio", { name: /Center/ }));
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("Sample Studio", "large", 25, "center", false);
  });

  it("submits the metadata strip when it is ticked", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "Sample Studio");
    await user.click(screen.getByRole("checkbox", { name: "Strip metadata from the copies" }));
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("Sample Studio", "medium", 50, "bottom", true);
  });

  it("starts from the stored metadata strip", () => {
    renderDialog({ strip_metadata: true });

    expect(screen.getByRole("checkbox", { name: "Strip metadata from the copies" })).toBeChecked();
  });

  it("keeps the tile groups independent", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: "Small" }));

    // A shared radio name would have cleared the other groups' selections.
    expect(screen.getByRole("radio", { name: "Small" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "50%" })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Bottom/ })).toBeChecked();
  });

  it("passes filtergraph metacharacters through untouched", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "a:b's 100%");
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("a:b's 100%", "medium", 50, "bottom", false);
  });

  it("requires watermark text", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Watermark text"), "   ");
    await confirm(user);

    expect(screen.getByRole("alert")).toHaveTextContent("Enter the watermark text.");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("drops pasted line breaks rather than sending them to drawtext", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByLabelText("Watermark text"));
    await user.paste("first\nsecond");
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("firstsecond", "medium", 50, "bottom", false);
  });

  it("caps the text at the length the backend accepts", () => {
    renderDialog();

    expect(screen.getByLabelText("Watermark text")).toHaveAttribute(
      "maxLength",
      String(MAX_WATERMARK_TEXT_LENGTH),
    );
  });

  it("disables its controls while the job is starting", () => {
    render(
      <WatermarkDialog
        scope={{ itemCount: 3, folderLabel: "Photos", fromSelection: false }}
        initialSettings={{ ...DEFAULTS, text: "Sample Studio" }}
        busy
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Watermark text")).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Large" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Top/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Strip metadata from the copies" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
  });
});
