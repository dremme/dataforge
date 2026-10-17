import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RenameDialog } from "./RenameDialog";

function renderDialog(props: Partial<Parameters<typeof RenameDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <RenameDialog
      title="Rename file"
      description="Renames the file."
      fieldLabel="File name"
      initialName="sunset"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onConfirm, onCancel, input: screen.getByLabelText("File name") };
}

describe("RenameDialog", () => {
  it("starts on the current name with it selected, so typing replaces it", async () => {
    const user = userEvent.setup();
    const { input } = renderDialog();

    expect(input).toHaveValue("sunset");
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("dusk");

    expect(input).toHaveValue("dusk");
  });

  it("offers Rename only for a name other than the current one", async () => {
    const user = userEvent.setup();
    const { input } = renderDialog();
    const rename = screen.getByRole("button", { name: "Rename" });

    expect(rename).toBeDisabled();

    await user.clear(input);
    expect(rename).toBeDisabled();

    await user.type(input, "   ");
    expect(rename).toBeDisabled();

    await user.clear(input);
    await user.type(input, "sunset");
    expect(rename).toBeDisabled();

    await user.type(input, "2");
    expect(rename).toBeEnabled();
  });

  it("accepts a change of case", async () => {
    const user = userEvent.setup();
    const { input } = renderDialog();

    await user.clear(input);
    await user.type(input, "Sunset");

    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("submits the trimmed name from the button", async () => {
    const user = userEvent.setup();
    const { input, onConfirm } = renderDialog();

    await user.clear(input);
    await user.type(input, "  dusk  ");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("dusk");
  });

  it("submits on Enter from the field, but not while the name is unchanged", async () => {
    const user = userEvent.setup();
    const { input, onConfirm } = renderDialog();

    await user.type(input, "{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "dusk{Enter}");
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("dusk");
  });

  it("shows the reason the backend refused the name", () => {
    renderDialog({ error: '"dusk.png" already exists in this folder.' });

    expect(screen.getByRole("alert")).toHaveTextContent('"dusk.png" already exists');
  });

  it("locks the field and the buttons while renaming", async () => {
    const { input } = renderDialog({ busy: true });

    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Renaming..." })).toBeDisabled();
  });
});
