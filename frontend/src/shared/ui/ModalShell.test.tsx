import { StrictMode, useRef } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import { ModalShell } from "./ModalShell";

// The app mounts under StrictMode, so these do too: its double-invoked effects
// are what surface focus bugs that a single-pass render hides.
function renderShell(props: Partial<Parameters<typeof ModalShell>[0]> = {}) {
  const onClose = props.onClose ?? vi.fn();

  const result = render(
    <StrictMode>
      <ModalShell block="test-modal" label="Test modal" {...props} onClose={onClose}>
        <button type="button">Inside</button>
      </ModalShell>
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

describe("ModalShell", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("keeps the backdrop outside the dialog", () => {
    renderShell({ backdropLabel: "Close test modal" });

    // Inside the dialog the backdrop would be announced as content: a stray
    // close button ahead of everything the overlay actually says.
    const backdrop = screen.getByRole("button", { name: "Close test modal" });
    expect(backdrop).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: "Close test modal" }),
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
        <ModalShell
          block="test-modal"
          label="Test modal"
          onClose={vi.fn()}
          initialFocusRef={inputRef}
        >
          <input ref={inputRef} aria-label="Name" />
        </ModalShell>
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
        <ModalShell block="second-modal" label="Second" onClose={vi.fn()}>
          <button type="button">Second body</button>
        </ModalShell>
      ) : (
        <ModalShell block="first-modal" label="First" onClose={vi.fn()}>
          <button type="button">First body</button>
        </ModalShell>
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
    const onClose = vi.fn();
    renderShell({ onClose, suspended: true, backdropLabel: "Close test modal" });

    // `hidden: true` is required precisely because the suspension worked: the
    // panel is out of the accessibility tree while the child overlay is up.
    const panel = screen.getByRole("dialog", { hidden: true });
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).not.toHaveAttribute("aria-modal");

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByRole("button", { name: "Close test modal" });
    expect(backdrop).toBeDisabled();
  });

  it("stops dismissing while busy", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderShell({ onClose, busy: true });

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and on a backdrop click", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderShell({ onClose, backdropLabel: "Close test modal" });

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Close test modal" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not let an editor overlay's Escape reach the overlay beneath it", async () => {
    const user = userEvent.setup();
    const onCloseParent = vi.fn();
    const onCloseChild = vi.fn();

    render(
      <StrictMode>
        <ModalShell block="parent-modal" label="Parent" onClose={onCloseParent}>
          <button type="button">Parent body</button>
        </ModalShell>
        <ModalShell block="child-editor" label="Child" onClose={onCloseChild} escape="editor">
          <button type="button">Child body</button>
        </ModalShell>
      </StrictMode>,
    );

    await user.keyboard("{Escape}");

    // The editor variant listens in the capture phase and stops propagation, so
    // the parent's window-level handler never runs.
    expect(onCloseChild).toHaveBeenCalledTimes(1);
    expect(onCloseParent).not.toHaveBeenCalled();
  });

  it("renders the drawer's panel as an aside carrying its aria-controls id", () => {
    renderShell({ panelAs: "aside", panelId: "test-modal-panel" });

    const panel = screen.getByRole("dialog");
    expect(panel.tagName).toBe("ASIDE");
    expect(panel).toHaveAttribute("id", "test-modal-panel");
  });

  it("swaps the entrance for the exit animation while closing", () => {
    const { rerender } = renderShell({ backdropLabel: "Close test modal" });
    expect(screen.getByRole("dialog")).toHaveClass("modal-panel--enter");

    rerender(
      <StrictMode>
        <ModalShell
          block="test-modal"
          label="Test modal"
          onClose={vi.fn()}
          backdropLabel="Close test modal"
          closing
        >
          <button type="button">Inside</button>
        </ModalShell>
      </StrictMode>,
    );

    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("modal-panel--exit");
    // Never both at once, or the two animations would race on one element.
    expect(panel).not.toHaveClass("modal-panel--enter");
    expect(screen.getByRole("button", { name: "Close test modal" })).toHaveClass(
      "modal-backdrop--exit",
    );
  });

  it("cannot be dismissed again while closing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderShell({ onClose, closing: true, backdropLabel: "Close test modal" });

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Close test modal" })).toBeDisabled();
  });

  it("reports the exit only when the panel's own animation ends", () => {
    const onExited = vi.fn();
    render(
      <StrictMode>
        <ModalShell
          block="test-modal"
          label="Test modal"
          onClose={vi.fn()}
          closing
          onExited={onExited}
        >
          <button type="button">Inside</button>
        </ModalShell>
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
      const onExited = vi.fn();
      render(
        <StrictMode>
          <ModalShell
            block="test-modal"
            label="Test modal"
            onClose={vi.fn()}
            closing
            onExited={onExited}
          >
            <button type="button">Inside</button>
          </ModalShell>
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
    const onExited = vi.fn();
    renderShell({ onExited });

    fireEvent.animationEnd(screen.getByRole("dialog"));
    expect(onExited).not.toHaveBeenCalled();
  });

  it("skips the enter animation when the caller has its own", () => {
    const { rerender } = renderShell();
    expect(screen.getByRole("dialog")).toHaveClass("modal-panel--enter");

    rerender(
      <StrictMode>
        <ModalShell block="test-modal" label="Test modal" onClose={vi.fn()} enterAnimation="none">
          <button type="button">Inside</button>
        </ModalShell>
      </StrictMode>,
    );
    expect(screen.getByRole("dialog")).not.toHaveClass("modal-panel--enter");
  });
});
