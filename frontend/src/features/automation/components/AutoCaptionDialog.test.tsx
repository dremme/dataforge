import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutoCaptionDialog } from "./AutoCaptionDialog";

function renderDialog(busy = false, onConfirm = vi.fn()) {
  render(
    <AutoCaptionDialog folderLabel="Photos" busy={busy} onConfirm={onConfirm} onCancel={vi.fn()} />,
  );

  return onConfirm;
}

function audioCheckbox() {
  return screen.getByRole("checkbox", { name: "Caption audio" });
}

function preserveThinkingCheckbox() {
  return screen.getByRole("checkbox", { name: "Preserve thinking" });
}

function confirm(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole("button", { name: "Start auto-caption" }));
}

describe("AutoCaptionDialog", () => {
  it("starts in reasoning mode with audio off", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeChecked();
    expect(audioCheckbox()).not.toBeChecked();
  });

  it("starts at medium effort with thinking preserved", () => {
    renderDialog();

    expect(screen.getByRole("radio", { name: /Medium/ })).toBeChecked();
    expect(preserveThinkingCheckbox()).toBeChecked();
  });

  it("submits the mode and leaves audio off by default", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", false, "medium", true);
  });

  it("submits the audio choice once it is checked", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(audioCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", true, "medium", true);
  });

  it("submits the reasoning choices once they are changed", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Extra high/ }));
    await user.click(preserveThinkingCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("thinking", false, "xhigh", false);
  });

  it("disables the reasoning controls in instruct mode", async () => {
    // Instruct turns reasoning off, so the backend sends neither value there. The
    // controls stay visible to say so rather than vanishing.
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("radio", { name: /Instruct/ }));

    expect(screen.getByRole("radio", { name: /Medium/ })).toBeDisabled();
    expect(preserveThinkingCheckbox()).toBeDisabled();
  });

  it("carries the audio choice alongside instruct mode", async () => {
    const user = userEvent.setup();
    const onConfirm = renderDialog();

    await user.click(screen.getByRole("radio", { name: /Instruct/ }));
    await user.click(audioCheckbox());
    await confirm(user);

    expect(onConfirm).toHaveBeenCalledWith("instruct", true, "medium", true);
  });

  it("disables its controls while the job is starting", () => {
    renderDialog(true);

    expect(audioCheckbox()).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Reasoning/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
  });
});
