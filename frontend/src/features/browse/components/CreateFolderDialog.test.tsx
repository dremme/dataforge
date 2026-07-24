import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreateFolderDialog } from "./CreateFolderDialog";

describe("CreateFolderDialog", () => {
  it("submits the trimmed folder name", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<CreateFolderDialog parentLabel="Photos" onConfirm={onConfirm} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Folder name"), "  Landscapes  ");
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    expect(onConfirm).toHaveBeenCalledWith("Landscapes");
  });

  it("shows API errors from the parent", async () => {
    render(
      <CreateFolderDialog
        parentLabel="Photos"
        error="Folder already exists"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Folder already exists");
  });

  it("disables submit until a name is entered", async () => {
    const user = userEvent.setup();

    render(<CreateFolderDialog parentLabel="Photos" onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Create folder" })).toBeDisabled();

    await user.type(screen.getByLabelText("Folder name"), "Landscapes");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Create folder" })).toBeEnabled();
    });
  });
});
