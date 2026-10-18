import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import { SIDECAR_SWEEP_COPY } from "@/features/gallery/lib/sidecarSweep";
import { SidecarSweepModal, type SidecarSweepModalProps } from "./SidecarSweepModal";

function renderSweep(overrides: Partial<SidecarSweepModalProps> = {}) {
  const props: SidecarSweepModalProps = {
    pending: "issue",
    count: 3,
    folderLabel: "Photos",
    busy: false,
    onConfirm: vi.fn<() => void>(),
    onCancel: vi.fn<() => void>(),
    ...overrides,
  };
  return { ...render(<SidecarSweepModal {...props} />), props };
}

describe("SidecarSweepModal", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("renders nothing when no sweep is pending", () => {
    renderSweep({ pending: null });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("opens the issue confirmation from SIDECAR_SWEEP_COPY", () => {
    renderSweep({ pending: "issue", count: 3 });

    const modal = screen.getByRole("alertdialog", { name: SIDECAR_SWEEP_COPY.issue.title });
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveTextContent("3 caption issue files");
    expect(modal).toHaveTextContent("Photos");
    expect(modal).toHaveTextContent("Captions and media are left untouched");
    expect(modal).toHaveTextContent("On Windows, files are moved to the Recycle Bin.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("opens the duplicate confirmation from SIDECAR_SWEEP_COPY", () => {
    renderSweep({ pending: "duplicate", count: 1 });

    const modal = screen.getByRole("alertdialog", { name: SIDECAR_SWEEP_COPY.duplicate.title });
    expect(modal).toHaveTextContent("1 duplicate finding file");
    expect(modal).toHaveTextContent("Photos");
    // The misreading this whole flow has to rule out.
    expect(modal).toHaveTextContent("The duplicate media themselves are left untouched");
  });

  it("shows Deleting... and keeps the modal busy", () => {
    renderSweep({ busy: true });

    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
  });

  it("confirms and cancels through the overlay handlers", async () => {
    const user = userEvent.setup();
    const { props } = renderSweep();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
