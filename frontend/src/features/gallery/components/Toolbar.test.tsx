import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "@/shared/hooks/scrollLockManager";
import type { CaptionFilter, MediaTypeFilter, SortOption } from "@/features/gallery/lib/query";
import { Toolbar } from "./Toolbar";

vi.mock("@/features/jobs/components/JobsButton", () => ({
  JobsButton: () => null,
}));

const defaultProps = {
  subfolderCount: 1,
  fileCount: 3,
  captionedCount: 2,
  searchQuery: "",
  searchRegex: false,
  sort: "name-asc" as SortOption,
  filter: "all" as CaptionFilter,
  filterCounts: {
    all: 3,
    captioned: 2,
    issue: 0,
    uncaptioned: 1,
  },
  mediaTypeFilter: "all" as MediaTypeFilter,
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("tracks the query length so the expanded field can grow with it", () => {
    const { rerender } = renderToolbar({ searchQuery: "sun" });

    const field = () => document.querySelector(".toolbar__search") as HTMLElement;
    expect(field().style.getPropertyValue("--toolbar-search-length")).toBe("3");

    rerender(<Toolbar {...defaultProps} searchQuery={"a".repeat(40)} />);
    expect(field().style.getPropertyValue("--toolbar-search-length")).toBe("40");
  });

  it("opens both filter groups from the filter menu", async () => {
    const user = userEvent.setup();
    renderToolbar({ mediaTypeFilter: "video" });

    expect(screen.queryByRole("menu", { name: "Filters" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter media" }));

    const menu = screen.getByRole("menu", { name: "Filters" });
    expect(within(menu).getByRole("group", { name: "Media type" })).toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Caption status" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Videos (1)" })).toBeChecked();

    await user.click(within(menu).getByRole("menuitemradio", { name: "Images (2)" }));
    expect(defaultProps.onMediaTypeFilterChange).toHaveBeenCalledWith("image");
    // Picking one axis leaves the menu open for the other.
    expect(screen.getByRole("menu", { name: "Filters" })).toBeInTheDocument();
  });

  it("closes the filter menu on Escape", async () => {
    const user = userEvent.setup();
    renderToolbar();

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    expect(screen.getByRole("menu", { name: "Filters" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("counts filter options against the active search", async () => {
    const user = userEvent.setup();
    renderToolbar({ searchQuery: "sun" });

    await user.click(screen.getByRole("button", { name: "Filter media" }));

    expect(
      screen.getByRole("menuitemradio", { name: 'Captioned (2 matching "sun")' }),
    ).toBeInTheDocument();
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
