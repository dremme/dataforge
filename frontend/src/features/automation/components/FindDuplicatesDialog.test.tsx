import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FindDuplicatesDialog } from "./FindDuplicatesDialog";

function renderDialog(onConfirm = vi.fn()) {
  render(
    <FindDuplicatesDialog
      folderLabel="Photos"
      itemCount={12}
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
