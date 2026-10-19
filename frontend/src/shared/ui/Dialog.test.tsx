import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { stubDialogClock } from "@/test/dialogClock";
import { Dialog, DialogActions } from "./Dialog";
import { DialogSuspendedContext } from "./dialogSuspendedContext";

function renderDialog(overrides: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const onConfirm = vi.fn<() => void>();
  const onClose = vi.fn<() => void>();

  // Stubbed before the render so the dialog stamps its open time on this clock.
  const { passOpenGrace } = stubDialogClock();

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

  return { onConfirm, onClose, passOpenGrace };
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
        <Dialog title="First" description="One" onClose={vi.fn<() => void>()} footer={null} />
        <Dialog title="Second" description="Two" onClose={vi.fn<() => void>()} footer={null} />
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

  it.each(["Cancel", "Close", "Escape", "Backdrop"])(
    "asks before %s discards changes and can keep editing",
    async (exit) => {
      const user = userEvent.setup();
      const { onClose, onConfirm } = renderDialog({ unsavedChanges: true });
      const dismiss = async () => {
        if (exit === "Escape") await user.keyboard("{Escape}");
        else
          await user.click(
            screen.getByRole("button", { name: exit === "Backdrop" ? "Close dialog" : exit }),
          );
      };

      await dismiss();
      const confirmation = await screen.findByRole("alertdialog", { name: "Discard changes?" });
      expect(onClose).not.toHaveBeenCalled();
      expect(onConfirm).not.toHaveBeenCalled();
      await user.click(within(confirmation).getByRole("button", { name: "Keep editing" }));
      expect(
        screen.queryByRole("alertdialog", { name: "Discard changes?" }),
      ).not.toBeInTheDocument();

      await dismiss();
      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it("ignores Enter immediately after opening", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog();

    await user.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();

    passOpenGrace();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape and confirms on Enter", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose, passOpenGrace } = renderDialog();
    passOpenGrace();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it.each(["Cancel", "Close"])("activates the focused %s button on Enter", async (name) => {
    const user = userEvent.setup();
    const { onConfirm, onClose, passOpenGrace } = renderDialog();
    passOpenGrace();

    screen.getByRole("button", { name }).focus();
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("activates a focused confirm button only once", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog();
    passOpenGrace();

    screen.getByRole("button", { name: "Start" }).focus();
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("leaves Enter to a focused select", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog({
      children: (
        <select aria-label="Mode" defaultValue="all">
          <option value="all">All files</option>
        </select>
      ),
    });
    passOpenGrace();

    screen.getByRole("combobox", { name: "Mode" }).focus();
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms from a single-line field", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog({
      children: <input aria-label="Name" />,
    });
    passOpenGrace();

    await user.click(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("{Enter}");

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("suspends Enter and Escape until a pending navigation finishes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => void>();
    const onClose = vi.fn<() => void>();
    const { passOpenGrace } = stubDialogClock();
    const form = (pending: boolean) => (
      <DialogSuspendedContext.Provider value={pending}>
        <Dialog title="Edit settings" onClose={onClose} onConfirm={onConfirm}>
          <input aria-label="Name" />
        </Dialog>
      </DialogSuspendedContext.Provider>
    );
    const { rerender } = render(form(false));
    passOpenGrace();
    screen.getByRole("textbox", { name: "Name" }).focus();
    rerender(form(true));
    await user.keyboard("{Enter}{Escape}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    rerender(form(false));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a keypress already handled by a field", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog({
      children: <input aria-label="Search" onKeyDown={(event) => event.preventDefault()} />,
    });
    passOpenGrace();

    screen.getByRole("textbox", { name: "Search" }).focus();
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("lets Enter insert a newline inside a textarea", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog({
      children: <textarea aria-label="Notes" defaultValue="" />,
    });
    passOpenGrace();

    await user.click(screen.getByLabelText("Notes"));
    await user.keyboard("one{Enter}two");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Notes")).toHaveValue("one\ntwo");
  });

  it("ignores Shift+Enter so multiline shortcuts stay available", async () => {
    const user = userEvent.setup();
    const { onConfirm, passOpenGrace } = renderDialog();
    passOpenGrace();

    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("ignores keyboard shortcuts while busy", async () => {
    const user = userEvent.setup();
    const { onConfirm, onClose, passOpenGrace } = renderDialog({ busy: true });
    passOpenGrace();

    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("focuses a requested field instead of the panel", () => {
    function WithInput() {
      const ref = { current: null } as { current: HTMLInputElement | null };
      return (
        <Dialog
          title="New folder"
          onClose={vi.fn<() => void>()}
          initialFocusRef={ref}
          footer={null}
        >
          <input ref={ref} aria-label="Folder name" />
        </Dialog>
      );
    }

    render(<WithInput />);

    expect(screen.getByLabelText("Folder name")).toHaveFocus();
  });

  it("omits aria-describedby when there is no description", () => {
    render(<Dialog title="Bare" onClose={vi.fn<() => void>()} footer={null} />);

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
        onConfirm={vi.fn<() => void>()}
        onCancel={vi.fn<() => void>()}
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
        onConfirm={vi.fn<() => void>()}
        onCancel={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByRole("button", { name: "Create folder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
