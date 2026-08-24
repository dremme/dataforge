import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FindDuplicatesDialog } from "./FindDuplicatesDialog";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";

const DEFAULTS: JobSettingsByType["find_duplicates"] =
  emptyAutomationSettings("C:/datasets/photos").find_duplicates;

function renderDialog(
  onConfirm = vi.fn(),
  overrides: Partial<JobSettingsByType["find_duplicates"]> = {},
) {
  render(
    <FindDuplicatesDialog
      scope={{ itemCount: 12, folderLabel: "Photos", fromSelection: false }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("FindDuplicatesDialog", () => {
  it("submits the near threshold by default", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("button", { name: "Find duplicates" }));

    expect(onConfirm).toHaveBeenCalledWith("near");
  });

  it("submits the chosen threshold", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Exact/ }));
    await user.click(screen.getByRole("button", { name: "Find duplicates" }));

    expect(onConfirm).toHaveBeenCalledWith("exact");
  });

  it("says matches will be marked in the gallery", () => {
    renderDialog();

    expect(screen.getByText(/Duplicates will be marked in the gallery/)).toBeInTheDocument();
  });
});

describe("FindDuplicatesDialog saved settings", () => {
  it("starts from the threshold the last run used", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog(vi.fn(), { threshold: "loose" });

    await user.click(screen.getByRole("button", { name: "Find duplicates" }));

    expect(onConfirm).toHaveBeenCalledWith("loose");
  });
});
