import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";
import { EditCaptionsDialog } from "./EditCaptionsDialog";

const DEFAULTS: JobSettingsByType["edit_captions"] =
  emptyAutomationSettings("C:/datasets/photos").edit_captions;

function renderDialog(
  overrides: Partial<JobSettingsByType["edit_captions"]> = {},
  onConfirm = vi.fn(),
) {
  render(
    <EditCaptionsDialog
      scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );

  return onConfirm;
}

function instructionField() {
  return screen.getByLabelText("Edit instruction");
}

function backupCheckbox() {
  return screen.getByLabelText("Back up captions first");
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Start edit captions" }));
}

describe("EditCaptionsDialog", () => {
  it("starts from the settings the last run used", () => {
    renderDialog({
      mode: "thinking",
      reasoning_effort: "xhigh",
      preserve_thinking: false,
      instruction: "Rewrite in present tense.",
    });

    expect(instructionField()).toHaveValue("Rewrite in present tense.");
    expect(screen.getByLabelText("Preserve thinking")).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeChecked();
  });

  it("ticks the backup box however the last run was started", () => {
    // The dangerous state is the unticked one, so it is never restored.
    renderDialog({ instruction: "Rewrite in present tense." });

    expect(backupCheckbox()).toBeChecked();
  });

  it("submits the instruction, the model controls and the backup choice", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({
      mode: "thinking",
      reasoning_effort: "low",
      preserve_thinking: true,
      instruction: "Rewrite in present tense.",
    });

    await user.click(backupCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith(
      "thinking",
      "Rewrite in present tense.",
      "low",
      true,
      false,
    );
  });

  it("trims the instruction before starting", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({ instruction: "  Drop the colours.  " });

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("instruct", "Drop the colours.", "medium", true, true);
  });

  it("refuses a blank instruction", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog({ instruction: "   " });

    await confirm(user);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an instruction for the edit.");
  });

  it("clears the error once the instruction is typed", async () => {
    const user = userEvent.setup();
    renderDialog({ instruction: "" });

    await confirm(user);
    expect(screen.queryByRole("alert")).not.toBeNull();

    await user.type(instructionField(), "Rewrite in present tense.");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the reasoning controls in instruct mode", () => {
    renderDialog({ mode: "instruct" });

    expect(screen.getByLabelText("Preserve thinking")).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Medium/ })).toBeDisabled();
  });

  it("confirms without writing preferences of its own", async () => {
    // Starting the job is what stores these, exactly as it is for every other dialog.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    const onConfirm = renderDialog({ instruction: "Rewrite in present tense." });

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes("/api/preferences"))).toEqual(
      [],
    );
    fetchSpy.mockRestore();
  });
});
