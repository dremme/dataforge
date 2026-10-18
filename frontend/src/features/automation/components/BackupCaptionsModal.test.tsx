import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BackupCaptionsModal } from "./BackupCaptionsModal";

describe("BackupCaptionsModal", () => {
  it("explains that existing backups are overwritten without offering a checkbox", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => void>();

    render(
      <BackupCaptionsModal
        scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
        initialSettings={{}}
        onConfirm={onConfirm}
        onCancel={vi.fn<() => void>()}
      />,
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Existing backups are overwritten.");

    await user.click(screen.getByRole("button", { name: "Back up captions" }));

    expect(onConfirm).toHaveBeenCalledWith();
  });

  it("does not start while a start is already in flight", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<() => void>();

    render(
      <BackupCaptionsModal
        scope={{ itemCount: 12, folderLabel: "Photos", kind: "folder" as const }}
        initialSettings={{}}
        busy
        onConfirm={onConfirm}
        onCancel={vi.fn<() => void>()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Starting..." }));

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
