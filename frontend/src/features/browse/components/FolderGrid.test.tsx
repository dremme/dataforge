import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Subfolder } from "@/shared/types";
import { FolderGrid } from "./FolderGrid";

function makeFolder(overrides: Partial<Subfolder> = {}): Subfolder {
  return {
    name: "Album",
    path: "C:\\Photos\\Album",
    file_count: 2,
    captioned_count: 1,
    issue_count: 0,
    ...overrides,
  };
}

describe("FolderGrid", () => {
  it("shows a warning triangle when a folder has issue files", () => {
    render(
      <FolderGrid
        folders={[
          makeFolder({ name: "Clean", path: "C:\\Photos\\Clean" }),
          makeFolder({
            name: "Needs review",
            path: "C:\\Photos\\Needs review",
            issue_count: 3,
          }),
        ]}
        onOpen={vi.fn()}
      />,
    );

    const clean = screen.getByRole("button", { name: "Clean" });
    const needsReview = screen.getByRole("button", {
      name: "Needs review (3 caption issues)",
    });

    expect(clean).toBeInTheDocument();
    expect(needsReview).toBeInTheDocument();
    expect(clean.querySelector(".folder-card__issue-icon")).toBeNull();

    const issueIcon = needsReview.querySelector(".folder-card__issue-icon");
    expect(issueIcon).not.toBeNull();
    expect(issueIcon?.parentElement).toHaveClass("folder-card__stat");
    expect(issueIcon?.previousSibling?.textContent).toContain("captioned");
  });
});
