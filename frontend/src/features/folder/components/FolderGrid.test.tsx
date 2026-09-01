import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Subfolder } from "@/shared/types";
import { FOLDER_CLAMP_LIMIT, FOLDER_CLAMP_MIN_HIDDEN } from "@/features/folder/lib/folderCards";
import { readFolderExpanded, writeFolderExpanded } from "@/features/folder/lib/folderExpansion";
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

  it("warns about duplicates on their own, with no caption issues", () => {
    render(
      <FolderGrid
        folders={[makeFolder({ issue_count: 0, duplicate_count: 2 })]}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole("button", { name: "Album (2 duplicates)" });

    expect(card.querySelector(".folder-card__issue-icon")).not.toBeNull();
  });

  it("names caption issues and duplicates separately rather than as a total", () => {
    // The two counts come from separate sidecars and one file can carry both, so a
    // 2-file folder can hold 2 issues and 2 duplicates without contradicting itself.
    render(
      <FolderGrid
        folders={[makeFolder({ issue_count: 2, duplicate_count: 2 })]}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Album (2 caption issues, 2 duplicates)" }),
    ).toBeInTheDocument();
  });

  it("puts a lone issue and a lone duplicate in the singular", () => {
    render(
      <FolderGrid
        folders={[makeFolder({ issue_count: 1, duplicate_count: 1 })]}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Album (1 caption issue, 1 duplicate)" }),
    ).toBeInTheDocument();
  });

  // duplicate_count arrives from a separate stats call and is optional, so gating the
  // warning on both counts being present would silently drop it.
  it("still warns about caption issues while the duplicate count is missing", () => {
    render(
      <FolderGrid
        folders={[makeFolder({ issue_count: 3, duplicate_count: null })]}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole("button", { name: "Album (3 caption issues)" });

    expect(card.querySelector(".folder-card__issue-icon")).not.toBeNull();
  });

  it("leaves a folder with no findings unlabelled and unmarked", () => {
    render(
      <FolderGrid
        folders={[makeFolder({ issue_count: 0, duplicate_count: 0 })]}
        onOpen={vi.fn()}
      />,
    );

    const card = screen.getByRole("button", { name: "Album" });

    expect(card.querySelector(".folder-card__issue-icon")).toBeNull();
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

// Enough hidden to clear the floor, so these hold whatever the constants are tuned to.
const HIDDEN = FOLDER_CLAMP_MIN_HIDDEN + 3;
const CLAMPED_TOTAL = FOLDER_CLAMP_LIMIT + HIDDEN;
const SHOW_MORE = `Show ${HIDDEN} more folders`;

function makeFolders(count: number, overrides: (index: number) => Partial<Subfolder> = () => ({})) {
  return Array.from({ length: count }, (_unused, index) =>
    makeFolder({ name: `Album ${index}`, path: `C:\\Photos\\${index}`, ...overrides(index) }),
  );
}

function cards() {
  return document.querySelectorAll(".folder-card");
}

describe("FolderGrid clamping", () => {
  it("shows a short list whole, with no expander", () => {
    const total = FOLDER_CLAMP_LIMIT + FOLDER_CLAMP_MIN_HIDDEN - 1;

    render(<FolderGrid folders={makeFolders(total)} onOpen={vi.fn()} />);

    expect(cards()).toHaveLength(total);
    expect(screen.queryByRole("button", { name: /more folders/ })).toBeNull();
  });

  it("holds a long list back behind a button naming the remainder", () => {
    render(<FolderGrid folders={makeFolders(CLAMPED_TOTAL)} onOpen={vi.fn()} />);

    expect(cards()).toHaveLength(FOLDER_CLAMP_LIMIT);
    const toggle = screen.getByRole("button", { name: SHOW_MORE });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.getAttribute("aria-controls")).toBe(document.querySelector(".folder-grid")?.id);
  });

  it("reveals the rest and offers the way back", async () => {
    const user = userEvent.setup();
    render(<FolderGrid folders={makeFolders(CLAMPED_TOTAL)} onOpen={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: SHOW_MORE }));

    expect(cards()).toHaveLength(CLAMPED_TOTAL);
    const toggle = screen.getByRole("button", { name: "Show fewer folders" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    expect(cards()).toHaveLength(FOLDER_CLAMP_LIMIT);
  });

  it("says how many hidden folders need review", () => {
    const flagged = [0, FOLDER_CLAMP_LIMIT, FOLDER_CLAMP_LIMIT + 1];
    const folders = makeFolders(CLAMPED_TOTAL, (index) =>
      flagged.includes(index) ? { issue_count: 2 } : {},
    );

    render(<FolderGrid folders={folders} onOpen={vi.fn()} />);

    expect(screen.getByRole("button", { name: new RegExp(SHOW_MORE) }).textContent).toContain(
      "2 need review",
    );
  });

  it("leaves the badge off when nothing hidden is flagged", () => {
    render(<FolderGrid folders={makeFolders(CLAMPED_TOTAL)} onOpen={vi.fn()} />);

    expect(document.querySelector(".folder-more__findings")).toBeNull();
  });

  it("drops the badge once the hidden folders are on screen", async () => {
    const user = userEvent.setup();
    const folders = makeFolders(CLAMPED_TOTAL, (index) =>
      index === FOLDER_CLAMP_LIMIT ? { issue_count: 2 } : {},
    );
    render(<FolderGrid folders={folders} onOpen={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: new RegExp(SHOW_MORE) }));

    expect(document.querySelector(".folder-more__findings")).toBeNull();
  });

  it("keeps the header count on the whole list, not the visible slice", () => {
    render(
      <FolderGrid
        folders={makeFolders(CLAMPED_TOTAL)}
        totalCount={CLAMPED_TOTAL}
        onOpen={vi.fn()}
      />,
    );

    expect(document.querySelector(".folder-section__count")?.textContent).toBe(
      String(CLAMPED_TOTAL),
    );
  });
});

describe("FolderGrid expansion memory", () => {
  const FOLDER = "C:\\Photos";

  it("saves the expansion against the folder it was made in", async () => {
    const user = userEvent.setup();
    render(
      <FolderGrid folders={makeFolders(CLAMPED_TOTAL)} folderPath={FOLDER} onOpen={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: SHOW_MORE }));

    expect(readFolderExpanded(FOLDER)).toBe(true);
  });

  it("opens expanded when that folder was left expanded", () => {
    writeFolderExpanded(FOLDER, true);

    render(
      <FolderGrid folders={makeFolders(CLAMPED_TOTAL)} folderPath={FOLDER} onOpen={vi.fn()} />,
    );

    expect(cards()).toHaveLength(CLAMPED_TOTAL);
    expect(screen.getByRole("button", { name: "Show fewer folders" })).toBeInTheDocument();
  });

  it("opens clamped again once the folder is collapsed", async () => {
    const user = userEvent.setup();
    writeFolderExpanded(FOLDER, true);
    const { unmount } = render(
      <FolderGrid folders={makeFolders(CLAMPED_TOTAL)} folderPath={FOLDER} onOpen={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Show fewer folders" }));
    unmount();
    render(
      <FolderGrid folders={makeFolders(CLAMPED_TOTAL)} folderPath={FOLDER} onOpen={vi.fn()} />,
    );

    expect(cards()).toHaveLength(FOLDER_CLAMP_LIMIT);
  });

  it("leaves a different folder clamped", () => {
    writeFolderExpanded(FOLDER, true);

    render(
      <FolderGrid
        folders={makeFolders(CLAMPED_TOTAL)}
        folderPath="C:\\Elsewhere"
        onOpen={vi.fn()}
      />,
    );

    expect(cards()).toHaveLength(FOLDER_CLAMP_LIMIT);
  });

  it("still expands for a caller that names no folder", async () => {
    const user = userEvent.setup();
    render(<FolderGrid folders={makeFolders(CLAMPED_TOTAL)} onOpen={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: SHOW_MORE }));

    expect(cards()).toHaveLength(CLAMPED_TOTAL);
  });
});
