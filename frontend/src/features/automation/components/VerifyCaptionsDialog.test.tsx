import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";
import { VerifyCaptionsDialog } from "./VerifyCaptionsDialog";

const DEFAULTS: JobSettingsByType["verify_captions"] =
  emptyAutomationSettings("C:/datasets/photos").verify_captions;

function renderDialog(
  overrides: Partial<JobSettingsByType["verify_captions"]> = {},
  onConfirm = vi.fn(),
) {
  render(
    <VerifyCaptionsDialog
      scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );

  return onConfirm;
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Start verify captions" }));
}

describe("VerifyCaptionsDialog", () => {
  it("starts from the settings the last run used", () => {
    renderDialog({
      mode: "thinking",
      reasoning_effort: "xhigh",
      preserve_thinking: false,
      context: "Studio product shots.",
    });

    expect(screen.getByLabelText("Additional context")).toHaveValue("Studio product shots.");
    expect(screen.getByLabelText("Preserve thinking")).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeChecked();
  });

  it("submits the settings it was opened with", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({
      mode: "thinking",
      reasoning_effort: "low",
      preserve_thinking: true,
      context: "Studio product shots.",
    });

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", "Studio product shots.", "low", true);
  });

  it("submits an edited context", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Additional context"), "Outdoor portraits.");
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("instruct", "Outdoor portraits.", "medium", true);
  });

  it("confirms without writing preferences of its own", async () => {
    // Starting the job is what stores these now; a second write from the dialog was
    // the inconsistency this replaced. The badge's own model lookup is not one.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/api/preferences"))).toEqual(
      [],
    );
    fetchSpy.mockRestore();
  });
});
