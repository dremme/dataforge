import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "../hooks/scrollLockManager";
import { Toolbar } from "./Toolbar";

vi.mock("./JobsButton", () => ({
  JobsButton: () => null,
}));

const defaultProps = {
  subfolderCount: 1,
  fileCount: 3,
  captionedCount: 2,
  searchQuery: "",
  searchRegex: false,
  sort: "name-asc" as const,
  filter: "all" as const,
  filterCounts: {
    all: 3,
    captioned: 2,
    issue: 0,
    uncaptioned: 1,
  },
  mediaTypeFilter: "all" as const,
  mediaTypeFilterCounts: {
    all: 3,
    image: 2,
    video: 1,
  },
  onSearchQueryChange: vi.fn(),
  onSearchRegexChange: vi.fn(),
  onSortChange: vi.fn(),
  onFilterChange: vi.fn(),
  onMediaTypeFilterChange: vi.fn(),
};

function renderToolbar(props: Partial<typeof defaultProps> = {}) {
  return render(<Toolbar {...defaultProps} {...props} />);
}

describe("Toolbar", () => {
  afterEach(() => {
    resetScrollLockManagerForTests();
    document.documentElement.className = "";
  });

  it("focuses the search input with Ctrl+K", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const search = screen.getByRole("searchbox", {
      name: "Search files and folders by name or caption",
    });
    expect(search).not.toHaveFocus();

    await user.keyboard("{Control>}k{/Control}");

    expect(search).toHaveFocus();
  });

  it("selects existing search text when focusing with the shortcut", async () => {
    const user = userEvent.setup();
    renderToolbar({ searchQuery: "sunset" });

    const search = screen.getByRole("searchbox", {
      name: "Search files and folders by name or caption",
    }) as HTMLInputElement;

    await user.keyboard("{Control>}k{/Control}");

    expect(search).toHaveFocus();
    expect(search.selectionStart).toBe(0);
    expect(search.selectionEnd).toBe("sunset".length);
  });

  it("does not focus search while an overlay is open", async () => {
    const user = userEvent.setup();
    const lock = acquireScrollLock("confirm-dialog-open");
    try {
      renderToolbar();

      const search = screen.getByRole("searchbox", {
        name: "Search files and folders by name or caption",
      });

      await user.keyboard("{Control>}k{/Control}");

      expect(search).not.toHaveFocus();
    } finally {
      releaseScrollLock(lock);
    }
  });
});
