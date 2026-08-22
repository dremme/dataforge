import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BatchRenameDialog } from "./BatchRenameDialog";

function renderDialog(onConfirm = vi.fn(), itemCount = 12) {
  render(
    <BatchRenameDialog
      scope={{ itemCount, folderLabel: "Photos", fromSelection: false }}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  return onConfirm;
}

describe("BatchRenameDialog", () => {
  it("submits the stem and a start number of 1 by default", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledWith("portugal", 1);
  });

  it("submits the chosen start number", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.clear(screen.getByLabelText("Start number"));
    await user.type(screen.getByLabelText("Start number"), "42");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledWith("portugal", 42);
  });

  it("previews the range the start number produces, padded to the highest number", async () => {
    const user = userEvent.setup();
    renderDialog(vi.fn(), 3);

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.clear(screen.getByLabelText("Start number"));
    await user.type(screen.getByLabelText("Start number"), "999");

    expect(screen.getByText("portugal_0999.png")).toBeInTheDocument();
    expect(screen.getByText("portugal_1001.png")).toBeInTheDocument();
  });

  it("refuses a start number that is not a whole number", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.type(screen.getByLabelText("Name stem"), "portugal");
    await user.clear(screen.getByLabelText("Start number"));
    await user.type(screen.getByLabelText("Start number"), "-4");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("whole number");
  });
});
