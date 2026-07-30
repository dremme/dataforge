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
  it("keeps the header with a count when there are no folders", () => {
    render(<FolderGrid folders={[]} onOpen={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Folders" })).toBeInTheDocument();
    expect(document.querySelector(".folder-section__count")).toHaveTextContent("0");
    expect(document.querySelector(".folder-grid")).toBeNull();
  });

  it("reports matches against the unfiltered total", () => {
    render(<FolderGrid folders={[makeFolder()]} totalCount={4} onOpen={vi.fn()} />);

    expect(screen.getByLabelText("1 of 4")).toHaveClass("folder-section__count");
  });

  it("marks the header when the browsed folder has backed up captions", () => {
    render(<FolderGrid folders={[]} hasCaptionBackup onOpen={vi.fn()} />);

    const badge = screen.getByLabelText("This folder has backed up captions");
    expect(badge).toHaveClass("section-header__backup-badge");
    expect(badge.closest(".folder-section__header")).not.toBeNull();
  });

  it("leaves the header unmarked without a backup", () => {
    render(<FolderGrid folders={[makeFolder()]} onOpen={vi.fn()} />);

    expect(document.querySelector(".section-header__backup-badge")).toBeNull();
  });

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
