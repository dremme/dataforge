import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetScrollLockManagerForTests } from "@/shared/hooks/scrollLockManager";
import { SIDECAR_SWEEP_COPY } from "@/features/gallery/lib/sidecarSweep";
import { SidecarSweepOverlay, type SidecarSweepOverlayProps } from "./SidecarSweepOverlay";

function renderSweep(overrides: Partial<SidecarSweepOverlayProps> = {}) {
  const props: SidecarSweepOverlayProps = {
    pending: "issue",
    count: 3,
    folderLabel: "Photos",
    busy: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return { ...render(<SidecarSweepOverlay {...props} />), props };
}

describe("SidecarSweepOverlay", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
  });

  it("renders nothing when no sweep is pending", () => {
    renderSweep({ pending: null });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("opens the issue confirmation from SIDECAR_SWEEP_COPY", () => {
    renderSweep({ pending: "issue", count: 3 });

    const dialog = screen.getByRole("alertdialog", { name: SIDECAR_SWEEP_COPY.issue.title });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent("3 caption issue files");
    expect(dialog).toHaveTextContent("Photos");
    expect(dialog).toHaveTextContent("Captions and media are left untouched");
    expect(dialog).toHaveTextContent("On Windows, files are moved to the Recycle Bin.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("opens the duplicate confirmation from SIDECAR_SWEEP_COPY", () => {
    renderSweep({ pending: "duplicate", count: 1 });

    const dialog = screen.getByRole("alertdialog", { name: SIDECAR_SWEEP_COPY.duplicate.title });
    expect(dialog).toHaveTextContent("1 duplicate finding file");
    expect(dialog).toHaveTextContent("Photos");
    // The misreading this whole flow has to rule out.
    expect(dialog).toHaveTextContent("The duplicate media themselves are left untouched");
  });

  it("shows Deleting... and keeps the dialog busy", () => {
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
