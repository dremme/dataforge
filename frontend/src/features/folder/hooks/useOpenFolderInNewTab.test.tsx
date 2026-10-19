import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VACATION_PATH } from "@/test/fixtures";
import { renderWithQueryClient } from "@/test/queryClient";
import { useOpenFolderInNewTab } from "./useOpenFolderInNewTab";

function FolderButton() {
  const openInNewTab = useOpenFolderInNewTab();
  return (
    <button type="button" {...openInNewTab(VACATION_PATH)}>
      Vacation
    </button>
  );
}

describe("useOpenFolderInNewTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the folder's address in a new tab on a middle click", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithQueryClient(<FolderButton />);
    const button = await screen.findByRole("button", { name: "Vacation" });

    expect(fireEvent.mouseDown(button, { button: 1 })).toBe(false);
    fireEvent(button, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));

    expect(open).toHaveBeenCalledExactlyOnceWith(
      `/?path=${encodeURIComponent(VACATION_PATH)}`,
      "_blank",
      "noopener",
    );
  });

  it("leaves other buttons alone", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderWithQueryClient(<FolderButton />);
    const button = await screen.findByRole("button", { name: "Vacation" });

    expect(fireEvent.mouseDown(button, { button: 0 })).toBe(true);
    fireEvent(button, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }));

    expect(open).not.toHaveBeenCalled();
  });
});
