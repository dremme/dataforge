import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FolderActivitySweep } from "./AppHeader";

describe("FolderActivitySweep", () => {
  it("shows the refresh sweep for a folder that is only refreshing", () => {
    render(<FolderActivitySweep refreshing tagging={false} />);

    expect(screen.getByRole("status", { name: "Refreshing folder" })).toBeInTheDocument();
  });

  it("keeps one tagging sweep through the refreshes its own tag writes cause", () => {
    // Each saved tag moves the folder fingerprint, so a folder being tagged refreshes every
    // few seconds; swapping sweeps for those restarted the animation and flickered.
    const { rerender } = render(<FolderActivitySweep refreshing={false} tagging />);
    const sweep = screen.getByRole("status", { name: "Tagging folder" });

    rerender(<FolderActivitySweep refreshing tagging />);
    expect(screen.getByRole("status", { name: "Tagging folder" })).toBe(sweep);
    expect(screen.queryByRole("status", { name: "Refreshing folder" })).toBeNull();

    rerender(<FolderActivitySweep refreshing={false} tagging />);
    expect(screen.getByRole("status", { name: "Tagging folder" })).toBe(sweep);
    expect(sweep).toHaveClass("app-nav__refresh--tagging");
  });
});
