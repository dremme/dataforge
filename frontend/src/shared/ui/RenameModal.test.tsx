import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { stubModalClock } from "@/test/modalClock";
import { RenameModal } from "./RenameModal";

function renderModal(props: Partial<Parameters<typeof RenameModal>[0]> = {}) {
  const onConfirm = vi.fn<(name: string) => void>();
  const onCancel = vi.fn<() => void>();
  render(
    <RenameModal
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

describe("RenameModal", () => {
  it("starts on the current name with it selected, so typing replaces it", async () => {
    const user = userEvent.setup();
    const { input } = renderModal();

    expect(input).toHaveValue("sunset");
    await waitFor(() => expect(input).toHaveFocus());
    await user.keyboard("dusk");

    expect(input).toHaveValue("dusk");
  });

  it("offers Rename only for a name other than the current one", async () => {
    const user = userEvent.setup();
    const { input } = renderModal();
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
    const { input } = renderModal();

    await user.clear(input);
    await user.type(input, "Sunset");

    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });

  it("submits the trimmed name from the button", async () => {
    const user = userEvent.setup();
    const { input, onConfirm } = renderModal();

    await user.clear(input);
    await user.type(input, "  dusk  ");
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("dusk");
  });

  it("submits on Enter from the field, but not while the name is unchanged", async () => {
    const { passOpenGrace } = stubModalClock();
    const user = userEvent.setup();
    const { input, onConfirm } = renderModal();
    passOpenGrace();

    await user.type(input, "{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "dusk{Enter}");
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("dusk");
  });

  it("shows the reason the backend refused the name", () => {
    renderModal({ error: '"dusk.png" already exists in this folder.' });

    expect(screen.getByRole("alert")).toHaveTextContent('"dusk.png" already exists');
  });

  it("locks the field and the buttons while renaming", async () => {
    const { input } = renderModal({ busy: true });

    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Renaming..." })).toBeDisabled();
  });
});
