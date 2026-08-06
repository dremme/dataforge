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

  it("holds the stat slot with a placeholder until counts arrive", () => {
    render(
      <FolderGrid
        folders={[
          makeFolder({
            file_count: null,
            captioned_count: null,
            issue_count: null,
          }),
        ]}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole("button", { name: "Album" });

    expect(card.querySelector(".folder-card__stat--pending")).not.toBeNull();
    expect(card.querySelector(".folder-card__stat-placeholder")).not.toBeNull();
    expect(card.textContent).not.toContain("captioned");
  });

  it("renders counts once they replace the placeholder", () => {
    render(
      <FolderGrid folders={[makeFolder({ file_count: 5, captioned_count: 5 })]} onOpen={vi.fn()} />,
    );

    const card = screen.getByRole("button", { name: "Album" });

    expect(card.querySelector(".folder-card__stat--pending")).toBeNull();
    expect(card.querySelector(".folder-card__stat")).toHaveClass("folder-card__stat--success");
    expect(card.textContent).toContain("captioned");
  });
});
