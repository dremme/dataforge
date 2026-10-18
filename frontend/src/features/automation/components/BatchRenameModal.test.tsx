import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BatchRenameModal } from "./BatchRenameModal";
import {
  emptyAutomationSettings,
  type JobSettingsByType,
} from "@/features/automation/preferences/automationPreferences";
import type { ComponentProps } from "react";

const DEFAULTS: JobSettingsByType["batch_rename"] =
  emptyAutomationSettings("C:/datasets/photos").batch_rename;

function renderModal(
  onConfirm = vi.fn<ComponentProps<typeof BatchRenameModal>["onConfirm"]>(),
  itemCount = 12,
  overrides: Partial<JobSettingsByType["batch_rename"]> = {},
) {
  render(
    <BatchRenameModal
      scope={{ itemCount, folderLabel: "Photos", kind: "folder" as const }}
      initialSettings={{ ...DEFAULTS, ...overrides }}
      onConfirm={onConfirm}
      onCancel={vi.fn<() => void>()}
    />,
  );
  return onConfirm;
}

describe("BatchRenameModal", () => {
  it("submits the stem and a start number of 1 by default", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledWith("portugal", 1);
  });

  it("submits the chosen start number", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.clear(screen.getByLabelText("Start number"));
    await user.type(screen.getByLabelText("Start number"), "42");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledWith("portugal", 42);
  });

  it("previews the range the start number produces, padded to the highest number", async () => {
    const user = userEvent.setup();
    renderModal(vi.fn(), 3);

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.clear(screen.getByLabelText("Start number"));
    await user.type(screen.getByLabelText("Start number"), "999");

    expect(screen.getByText("portugal_0999.png")).toBeInTheDocument();
    expect(screen.getByText("portugal_1001.png")).toBeInTheDocument();
  });

  it("refuses a start number that is not a whole number", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal();

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.clear(screen.getByLabelText("Start number"));
    await user.type(screen.getByLabelText("Start number"), "-4");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("whole number");
  });
});

describe("BatchRenameModal saved settings", () => {
  it("starts from the stem and number the last run used", async () => {
    const user = userEvent.setup();
    const onConfirm = renderModal(vi.fn(), 12, { stem: "shot", start_number: 7 });

    expect(screen.getByLabelText("Name stem")).toHaveValue("shot");

    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledWith("shot", 7);
  });
});
