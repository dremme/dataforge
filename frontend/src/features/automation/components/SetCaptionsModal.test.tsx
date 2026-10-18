import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SetCaptionsModal } from "./SetCaptionsModal";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const DEFAULTS: JobSettingsByType["set_captions"] =
  emptyAutomationSettings("C:/datasets/photos").set_captions;

describe("SetCaptionsModal", () => {
  it("focuses the caption field on open", () => {
    render(
      <SetCaptionsModal
        scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
        initialSettings={DEFAULTS}
        onConfirm={vi.fn<(caption: string, overwrite: boolean) => void>()}
        onCancel={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByLabelText("Caption text")).toHaveFocus();
  });

  it("submits the caption text and the overwrite choice", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(caption: string, overwrite: boolean) => void>();

    render(
      <SetCaptionsModal
        scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
        initialSettings={DEFAULTS}
        onConfirm={onConfirm}
        onCancel={vi.fn<() => void>()}
      />,
    );

    await user.type(screen.getByLabelText("Caption text"), "a scenic mountain landscape");
    await user.click(screen.getByLabelText("Overwrite existing captions"));
    await user.click(screen.getByRole("button", { name: "Set captions" }));

    expect(onConfirm).toHaveBeenCalledWith("a scenic mountain landscape", true);
  });

  it("keeps Enter in the caption field instead of submitting", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(caption: string, overwrite: boolean) => void>();

    render(
      <SetCaptionsModal
        scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
        initialSettings={DEFAULTS}
        onConfirm={onConfirm}
        onCancel={vi.fn<() => void>()}
      />,
    );

    // The field is focused on open, so the first Enter must add a newline.
    await user.keyboard("first{Enter}second");

    expect(screen.getByLabelText("Caption text")).toHaveValue("first\nsecond");
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("SetCaptionsModal saved settings", () => {
  function renderWith(caption: string) {
    render(
      <SetCaptionsModal
        scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
        initialSettings={{ caption }}
        onConfirm={vi.fn<(caption: string, overwrite: boolean) => void>()}
        onCancel={vi.fn<() => void>()}
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
