import { StrictMode, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import { DialogShell } from "./DialogShell";

// The app mounts under StrictMode, so these do too: its double-invoked effects
// are what surface focus bugs that a single-pass render hides.
function renderShell(props: Partial<Parameters<typeof DialogShell>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn<() => void>();

  const result = render(
    <StrictMode>
      <DialogShell block="test-dialog" label="Test dialog" {...props} onClose={onClose}>
        <button type="button">Inside</button>
      </DialogShell>
    </StrictMode>,
  );

  return { ...result, onClose };
}

/** A focusable element outside the overlay, standing in for the opener. */
function mountTrigger(): HTMLButtonElement {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  return trigger;
}

describe("DialogShell", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("keeps the backdrop outside the dialog", () => {
    renderShell({ backdropLabel: "Close test dialog" });

    // Inside the dialog the backdrop would be announced as content: a stray
    // close button ahead of everything the overlay actually says.
    const backdrop = screen.getByRole("button", { name: "Close test dialog" });
    expect(backdrop).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: "Close test dialog" }),
    ).toBeNull();
  });

  it("focuses the panel on open", () => {
    renderShell();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("focuses initialFocusRef instead of the panel when given", () => {
    function WithField() {
      const inputRef = useRef<HTMLInputElement>(null);
      return (
        <DialogShell
          block="test-dialog"
          label="Test dialog"
          onClose={vi.fn<() => void>()}
          initialFocusRef={inputRef}
        >
          <input ref={inputRef} aria-label="Name" />
        </DialogShell>
      );
    }

    render(
      <StrictMode>
        <WithField />
      </StrictMode>,
    );
    expect(screen.getByLabelText("Name")).toHaveFocus();
  });

  it("returns focus to the trigger on close", async () => {
    const trigger = mountTrigger();
    const { unmount } = renderShell();
    expect(trigger).not.toHaveFocus();

    unmount();
    await waitFor(() => expect(trigger).toHaveFocus());

    trigger.remove();
  });

  it("leaves focus alone when a successor overlay claims it in the same commit", async () => {
    const trigger = mountTrigger();

    function Swapping({ second }: { second: boolean }) {
      return second ? (
        <DialogShell block="second-dialog" label="Second" onClose={vi.fn<() => void>()}>
          <button type="button">Second body</button>
        </DialogShell>
      ) : (
        <DialogShell block="first-dialog" label="First" onClose={vi.fn<() => void>()}>
          <button type="button">First body</button>
        </DialogShell>
      );
    }

    const { rerender } = render(
      <StrictMode>
        <Swapping second={false} />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <Swapping second={true} />
      </StrictMode>,
    );

    // The hand-off must win: yanking focus back to the trigger here would drop
    // the user out of an overlay that is still open.
    const second = screen.getByRole("dialog", { name: "Second" });
    await waitFor(() => expect(second).toHaveFocus());
    expect(trigger).not.toHaveFocus();

    trigger.remove();
  });

  it("stops dismissing while suspended and marks the panel inert", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderShell({ onClose, suspended: true, backdropLabel: "Close test dialog" });

    // `hidden: true` is required precisely because the suspension worked: the
    // panel is out of the accessibility tree while the child overlay is up.
    const panel = screen.getByRole("dialog", { hidden: true });
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).not.toHaveAttribute("aria-modal");

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole("button", { name: "Close test dialog" });
    expect(backdrop).toBeDisabled();
  });

  it("stops dismissing while busy", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderShell({ onClose, busy: true });

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and on a backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderShell({ onClose, backdropLabel: "Close test dialog" });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close test dialog" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not let an editor overlay's Escape reach the overlay beneath it", async () => {
    const user = userEvent.setup();
    const onCloseParent = vi.fn<() => void>();
    const onCloseChild = vi.fn<() => void>();

    render(
      <StrictMode>
        <DialogShell block="parent-dialog" label="Parent" onClose={onCloseParent}>
          <button type="button">Parent body</button>
        </DialogShell>
        <DialogShell block="child-editor" label="Child" onClose={onCloseChild} escape="editor">
          <button type="button">Child body</button>
        </DialogShell>
      </StrictMode>,
    );

    await user.keyboard("{Escape}");

    // The editor variant listens in the capture phase and stops propagation, so
    // the parent's window-level handler never runs.
    expect(onCloseChild).toHaveBeenCalledTimes(1);
    expect(onCloseParent).not.toHaveBeenCalled();
  });

  it("renders the drawer's panel as an aside carrying its aria-controls id", () => {
    renderShell({ panelAs: "aside", panelId: "test-dialog-panel" });

    const panel = screen.getByRole("dialog");
    expect(panel.tagName).toBe("ASIDE");
    expect(panel).toHaveAttribute("id", "test-dialog-panel");
  });

  it("swaps the entrance for the exit animation while closing", () => {
    const { rerender } = renderShell({ backdropLabel: "Close test dialog" });
    expect(screen.getByRole("dialog")).toHaveClass("dialog-panel--enter");

    rerender(
      <StrictMode>
        <DialogShell
          block="test-dialog"
          label="Test dialog"
          onClose={vi.fn<() => void>()}
          backdropLabel="Close test dialog"
          closing
        >
          <button type="button">Inside</button>
        </DialogShell>
      </StrictMode>,
    );

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("dialog-panel--exit");
    // Never both at once, or the two animations would race on one element.
    expect(panel).not.toHaveClass("dialog-panel--enter");
    expect(screen.getByRole("button", { name: "Close test dialog" })).toHaveClass(
      "dialog-backdrop--exit",
    );
  });

  it("cannot be dismissed again while closing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn<() => void>();
    renderShell({ onClose, closing: true, backdropLabel: "Close test dialog" });

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close test dialog" })).toBeDisabled();
  });

  it("reports the exit only when the panel's own animation ends", () => {
    const onExited = vi.fn<() => void>();
    render(
      <StrictMode>
        <DialogShell
          block="test-dialog"
          label="Test dialog"
          onClose={vi.fn<() => void>()}
          closing
          onExited={onExited}
        >
          <button type="button">Inside</button>
        </DialogShell>
      </StrictMode>,
    );

    // A child finishing its own animation (a spinner, an entering row) must not
    // unmount the overlay out from under the exit.
    fireEvent.animationEnd(screen.getByRole("button", { name: "Inside" }));
    expect(onExited).not.toHaveBeenCalled();

    fireEvent.animationEnd(screen.getByRole("dialog"));
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it("still exits when the animation never ends", () => {
    vi.useFakeTimers();
    try {
      const onExited = vi.fn<() => void>();
      render(
        <StrictMode>
          <DialogShell
            block="test-dialog"
            label="Test dialog"
            onClose={vi.fn<() => void>()}
            closing
            onExited={onExited}
          >
            <button type="button">Inside</button>
          </DialogShell>
        </StrictMode>,
      );

      // A hidden tab freezes the animation at 0 and never fires `animationend`.
      // Without this backstop the overlay would sit there holding its lock.
      expect(onExited).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(onExited).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores animation ends when it is not closing", () => {
    const onExited = vi.fn<() => void>();
    renderShell({ onExited });

    fireEvent.animationEnd(screen.getByRole("dialog"));
    expect(onExited).not.toHaveBeenCalled();
  });

  it("skips the enter animation when the caller has its own", () => {
    const { rerender } = renderShell();
    expect(screen.getByRole("dialog")).toHaveClass("dialog-panel--enter");

    rerender(
      <StrictMode>
        <DialogShell
          block="test-dialog"
          label="Test dialog"
          onClose={vi.fn<() => void>()}
          enterAnimation="none"
        >
          <button type="button">Inside</button>
        </DialogShell>
      </StrictMode>,
    );
    expect(screen.getByRole("dialog")).not.toHaveClass("dialog-panel--enter");
  });
});
