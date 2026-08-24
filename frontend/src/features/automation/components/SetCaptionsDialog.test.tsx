import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetCaptionsDialog } from "./SetCaptionsDialog";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const DEFAULTS: JobSettingsByType["set_captions"] =
  emptyAutomationSettings("C:/datasets/photos").set_captions;

describe("SetCaptionsDialog", () => {
  it("focuses the caption field on open", () => {
    render(
      <SetCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={DEFAULTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Caption text")).toHaveFocus();
  });

  it("submits the caption text and the overwrite choice", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <SetCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={DEFAULTS}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Caption text"), "a scenic mountain landscape");
    await user.click(screen.getByLabelText("Overwrite existing captions"));
    await user.click(screen.getByRole("button", { name: "Set captions" }));

    expect(onConfirm).toHaveBeenCalledWith("a scenic mountain landscape", true);
  });

  it("keeps Enter in the caption field instead of submitting", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <SetCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={DEFAULTS}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // The field is focused on open, so the first Enter must add a newline.
    await user.keyboard("first{Enter}second");

    expect(screen.getByLabelText("Caption text")).toHaveValue("first\nsecond");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("SetCaptionsDialog saved settings", () => {
  function renderWith(caption: string) {
    render(
      <SetCaptionsDialog
        scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
        initialSettings={{ caption }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  }

  it("starts from the caption the last run used", () => {
    renderWith("A mountain lake.");

    expect(screen.getByLabelText("Caption text")).toHaveValue("A mountain lake.");
  });

  it("leaves overwrite off however the last run was started", () => {
    renderWith("A mountain lake.");

    expect(screen.getByLabelText("Overwrite existing captions")).not.toBeChecked();
  });
});
