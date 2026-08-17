import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLockManagerForTests,
} from "@/shared/hooks/scrollLockManager";
import type { ItemFilter, MediaTypeFilter, SortOption } from "@/features/gallery/lib/query";
import { Toolbar } from "./Toolbar";

vi.mock("@/features/jobs/components/JobsButton", () => ({
  JobsButton: () => null,
}));

const defaultProps = {
  subfolderCount: 1,
  fileCount: 3,
  captionedCount: 2,
  issueCount: 0,
  hasCaptionBackup: false,
  searchQuery: "",
  searchRegex: false,
  searchNames: true,
  sort: "name-asc" as SortOption,
  filter: "all" as ItemFilter,
  filterCounts: {
    all: 3,
    captioned: 2,
    issue: 0,
    uncaptioned: 1,
    duplicate: 0,
  },
  mediaTypeFilter: "all" as MediaTypeFilter,
  mediaTypeFilterCounts: {
    all: 3,
    image: 2,
    video: 1,
  },
  statsOpen: false,
  onToggleStats: vi.fn(),
  onSearchQueryChange: vi.fn(),
  onSearchRegexChange: vi.fn(),
  onSearchNamesChange: vi.fn(),
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

  it("toggles matching names in search", async () => {
    const user = userEvent.setup();
    renderToolbar({ searchQuery: "sun", searchNames: true });

    const namesToggle = screen.getByRole("button", { name: "Match file and folder names" });
    const regexToggle = screen.getByRole("button", { name: "Toggle regular expression search" });

    expect(namesToggle).toHaveAttribute("aria-pressed", "true");
    expect(
      namesToggle.compareDocumentPosition(regexToggle) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(namesToggle);

    expect(defaultProps.onSearchNamesChange).toHaveBeenCalledWith(false);
  });

  it("labels the search box for captions only when names are excluded", () => {
    renderToolbar({ searchNames: false });

    expect(screen.getByRole("searchbox", { name: "Search captions" })).toBeInTheDocument();
  });

  it("opens both filter groups from the filter menu", async () => {
    const user = userEvent.setup();
    renderToolbar({ mediaTypeFilter: "video" });

    expect(screen.queryByRole("menu", { name: "Filters" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filter media" }));

    const menu = screen.getByRole("menu", { name: "Filters" });
    expect(within(menu).getByRole("group", { name: "Media type" })).toBeInTheDocument();
    expect(within(menu).getByRole("group", { name: "Caption status" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitemradio", { name: "Videos and GIFs (1)" })).toBeChecked();

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

  it("shows caption issues as a warning count next to the other stats", () => {
    renderToolbar({ issueCount: 2 });

    const stat = screen.getByLabelText("2 caption issues");
    expect(stat).toHaveClass("stat--warning");
    expect(stat).toHaveTextContent("2");
    expect(stat.closest(".toolbar__stats")).not.toBeNull();
  });

  it("filters to caption issues when the issue count is clicked", async () => {
    const user = userEvent.setup();
    renderToolbar({ issueCount: 2 });

    await user.click(screen.getByLabelText("2 caption issues"));

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith("issue");
  });

  it("clears the filter when the active issue count is clicked again", async () => {
    const user = userEvent.setup();
    renderToolbar({ issueCount: 2, filter: "issue" });

    const stat = screen.getByLabelText("2 caption issues");

    await user.click(stat);

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith("all");
  });

  it("filters to captioned files when the captioned count is clicked", async () => {
    const user = userEvent.setup();
    renderToolbar();

    const stat = screen.getByLabelText("2 captioned (67%)");
    expect(stat).toHaveClass("stat--filter");

    await user.click(stat);

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith("captioned");
  });

  it("clears the filter when the active captioned count is clicked again", async () => {
    const user = userEvent.setup();
    renderToolbar({ filter: "captioned" });

    const stat = screen.getByLabelText("2 captioned (67%)");

    await user.click(stat);

    expect(defaultProps.onFilterChange).toHaveBeenCalledWith("all");
  });

  it("names a single caption issue in the singular", () => {
    renderToolbar({ issueCount: 1 });

    expect(screen.getByLabelText("1 caption issue")).toBeInTheDocument();
  });

  it("hides the issue count when the folder has none", () => {
    renderToolbar();

    expect(screen.queryByLabelText(/caption issue/)).not.toBeInTheDocument();
  });

  it("marks the stats when the open folder has backed up captions", () => {
    renderToolbar({ hasCaptionBackup: true });

    const badge = screen.getByLabelText("This folder has backed up captions");
    expect(badge).toHaveClass("stat--backup");
    expect(badge.closest(".toolbar__stats")).not.toBeNull();
  });

  it("leaves the stats unmarked without a backup", () => {
    renderToolbar();

    expect(document.querySelector(".stat--backup")).toBeNull();
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
