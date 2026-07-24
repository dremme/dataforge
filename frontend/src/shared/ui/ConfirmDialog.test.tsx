import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "@/shared/hooks/scrollLockManager";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("keeps the blurred backdrop after parent re-renders", () => {
    const { rerender } = render(
      <ConfirmDialog
        title="Start auto-caption job?"
        description="Complete short draft captions for images in Photos."
        confirmLabel="Start auto-caption"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const backdrop = () => screen.getByRole("button", { name: "Close dialog" });
    expect(backdrop()).not.toHaveClass("confirm-dialog__backdrop--nested");

    rerender(
      <ConfirmDialog
        title="Start auto-caption job?"
        description="Updated by a background folder refresh."
        confirmLabel="Start auto-caption"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(backdrop()).not.toHaveClass("confirm-dialog__backdrop--nested");
  });

  it("uses the nested backdrop when another overlay was open on mount", () => {
    const handle = acquireScrollLock("jobs-drawer-open");

    render(
      <ConfirmDialog
        title="Delete all job records?"
        description="This permanently removes all job records from history."
        confirmLabel="Delete all"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Close dialog" })).toHaveClass(
      "confirm-dialog__backdrop--nested",
    );

    releaseScrollLock(handle);
  });

  it("focuses the panel when it opens", () => {
    render(
      <ConfirmDialog
        title="Delete file?"
        description="This will permanently delete sunset.png."
        confirmLabel="Delete"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole("alertdialog", { name: "Delete file?" })).toHaveFocus();
  });

  it("confirms with Enter and cancels with Escape", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Delete all job records?"
        description="This permanently removes all job records from history."
        confirmLabel="Delete all"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    onCancel.mockClear();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("does not respond to keyboard shortcuts while busy", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        title="Delete all job records?"
        description="This permanently removes all job records from history."
        confirmLabel="Deleting..."
        busy
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("renders action buttons with accessible labels", () => {
    render(
      <ConfirmDialog
        title="Start auto-caption job?"
        description="Complete short draft captions for images in Photos."
        confirmLabel="Start auto-caption"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(
      screen.getByRole("alertdialog", { name: "Start auto-caption job?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start auto-caption" })).toBeInTheDocument();
  });
});
