import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FindDuplicatesModal } from "./FindDuplicatesModal";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";
import type { ComponentProps } from "react";

const DEFAULTS: JobSettingsByType["find_duplicates"] =
  emptyAutomationSettings("C:/datasets/photos").find_duplicates;

function renderModal(
  onConfirm = vi.fn<ComponentProps<typeof FindDuplicatesModal>["onConfirm"]>(),
  overrides: Partial<JobSettingsByType["find_duplicates"]> = {},
) {
  render(
    <FindDuplicatesModal
      scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn<() => void>()}
    />,
  );
  return onConfirm;
}

describe("FindDuplicatesModal", () => {
  it("submits the near threshold by default", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.click(screen.getByRole("button", { name: "Find duplicates" }));

    expect(onConfirm).toHaveBeenCalledWith("near");
  });

  it("submits the chosen threshold", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.click(screen.getByRole("radio", { name: /Exact/ }));
    await user.click(screen.getByRole("button", { name: "Find duplicates" }));

    expect(onConfirm).toHaveBeenCalledWith("exact");
  });

  it("says matches will be marked in the gallery", () => {
    renderModal();

    expect(screen.getByText(/Duplicates will be marked in the gallery/)).toBeInTheDocument();
  });
});

describe("FindDuplicatesModal saved settings", () => {
  it("starts from the threshold the last run used", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal(vi.fn(), { threshold: "loose" });

    await user.click(screen.getByRole("button", { name: "Find duplicates" }));

    expect(onConfirm).toHaveBeenCalledWith("loose");
  });
});
