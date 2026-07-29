import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog, DialogActions } from "./Dialog";

function renderDialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();

  render(
    <Dialog
      title="Start job?"
      description="Runs over every file in the folder."
      onConfirm={onConfirm}
      onClose={onClose}
      footer={<DialogActions confirmLabel="Start" onConfirm={onConfirm} onCancel={onClose} />}
      {...overrides}
    />,
  );

  return { onConfirm, onClose };
}

/** Enter is ignored for OPEN_GRACE_MS after mount. */
async function passOpenGrace() {
  await new Promise((resolve) => setTimeout(resolve, 120));
}

describe("Dialog", () => {
  it("wires the accessible name and description to the panel", () => {
    renderDialog();

    const panel = screen.getByRole("alertdialog", { name: "Start job?" });
    expect(panel).toHaveAccessibleDescription("Runs over every file in the folder.");
  });

  it("generates unique ids so stacked dialogs do not collide", () => {
    render(
      <>
        <Dialog title="First" description="One" onClose={vi.fn()} footer={null} />
        <Dialog title="Second" description="Two" onClose={vi.fn()} footer={null} />
      </>,
    );

    const [first, second] = screen.getAllByRole("alertdialog");
    expect(first.getAttribute("aria-labelledby")).not.toBe(second.getAttribute("aria-labelledby"));
    expect(first).toHaveAccessibleName("First");
    expect(second).toHaveAccessibleName("Second");
  });

  it("focuses the panel on open", () => {
    renderDialog();

    expect(screen.getByRole("alertdialog", { name: "Start job?" })).toHaveFocus();
  });

  it("ignores Enter immediately after opening", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();

    await passOpenGrace();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and confirms on Enter", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog();
    await passOpenGrace();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("lets Enter insert a newline inside a textarea", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog({
      children: <textarea aria-label="Notes" defaultValue="" />,
    });
    await passOpenGrace();

    await user.click(screen.getByLabelText("Notes"));
    await user.keyboard("one{Enter}two");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Notes")).toHaveValue("one\ntwo");
  });

  it("ignores Shift+Enter so multiline shortcuts stay available", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();
    await passOpenGrace();

    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores keyboard shortcuts while busy", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose } = renderDialog({ busy: true });
    await passOpenGrace();

    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses a requested field instead of the panel", () => {
    function WithInput() {
      const ref = { current: null } as { current: HTMLInputElement | null };
      return (
        <Dialog title="New folder" onClose={vi.fn()} initialFocusRef={ref} footer={null}>
          <input ref={ref} aria-label="Folder name" />
        </Dialog>
      );
    }

    render(<WithInput />);

    expect(screen.getByLabelText("Folder name")).toHaveFocus();
  });

  it("omits aria-describedby when there is no description", () => {
    render(<Dialog title="Bare" onClose={vi.fn()} footer={null} />);

    expect(screen.getByRole("alertdialog")).not.toHaveAttribute("aria-describedby");
  });
});

describe("DialogActions", () => {
  it("swaps in the busy label and disables both buttons", () => {
    render(
      <DialogActions
        confirmLabel="Start detection"
        busyLabel="Starting..."
        busy
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Starting..." });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("keeps the confirm button disabled when the form is incomplete", () => {
    render(
      <DialogActions
        confirmLabel="Create folder"
        confirmDisabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Create folder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
