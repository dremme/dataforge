import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EMPTY_PATH, HOME_PATH, VACATION_PATH, homeFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";
import type { FolderResponse } from "@/shared/types";

/** Home, with sunset.png carrying a caption issue the resolver can act on. */
const issueFolder: FolderResponse = {
  ...homeFolder,
  items: homeFolder.items.map((item) =>
    item.name === "sunset.png"
      ? { ...item, has_issue_file: true, issue_fixes: ['Replace "lake" with "river".'] }
      : item,
  ),
};

/** The first load asks for no path, so both keys have to carry the payload. */
function installIssueBackend() {
  return installMockBackend({
    folderByPath: { undefined: issueFolder, [HOME_PATH]: issueFolder },
  });
}

describe("App", () => {
  it("shows folder not found when the current folder is deleted in the background", async () => {
    const { removeFolder } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    removeFolder(HOME_PATH);

    await waitFor(
      () => {
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
        expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  }, 10_000);

  it("shows an initial loading state before the home folder renders", async () => {
    installMockBackend({ folderDelayMs: 50 });
    await renderApp();

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
    });
  });

  it("renders subfolders, media, and toolbar stats for the home folder", async () => {
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    expect(screen.getByRole("region", { name: "Automation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit instructions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View beach.jpg" })).toBeInTheDocument();

    const stats = document.querySelector(".toolbar__stats");
    expect(stats).toHaveTextContent("2");
    expect(stats).toHaveTextContent("1");
    expect(screen.getByLabelText("2 folders")).toBeInTheDocument();
    expect(screen.getByLabelText("3 files")).toBeInTheDocument();
    expect(screen.getByLabelText("1 captioned (33%)")).toBeInTheDocument();
  });

  it("navigates into a subfolder when a folder card is opened", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Vacation/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Create instructions" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View sunset.png" })).not.toBeInTheDocument();

    const folderCalls = fetchMock.mock.calls.filter(([input]) => {
      const requestUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(requestUrl, "http://localhost").pathname === "/api/folders/contents";
    });
    expect(
      folderCalls.some(([input]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return new URL(requestUrl, "http://localhost").searchParams.get("path") === VACATION_PATH;
      }),
    ).toBe(true);
  });

  it("shows a revisited folder from cache without refetching it or wiping the grid", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Vacation/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    const pathsListed = () =>
      fetchMock.mock.calls
        .map(([input]) =>
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        )
        .map((requestUrl) => new URL(requestUrl, "http://localhost"))
        .filter((parsed) => parsed.pathname === "/api/folders/contents")
        .map((parsed) => parsed.searchParams.get("path"));

    const listingsBeforeReturn = pathsListed().length;

    await user.click(screen.getByRole("button", { name: /Photos/ }));

    // The cached payload paints immediately - no skeleton in between.
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    expect(document.querySelector(".folder-card--skeleton")).toBeNull();

    // The fingerprint check confirms nothing moved, so no second full folder.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const requestUrl =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          return new URL(requestUrl, "http://localhost").pathname === "/api/folders/fingerprint";
        }),
      ).toBe(true);
    });
    expect(pathsListed()).toHaveLength(listingsBeforeReturn);
  });

  it("fills in subfolder counts after the folder cards have rendered", async () => {
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await waitFor(() => {
      const card = screen.getByRole("button", { name: /Vacation/ });
      expect(card.querySelector(".folder-card__stat-placeholder")).toBeNull();
      expect(card.textContent).toContain("captioned");
    });
  });

  it("shows an empty-folder message when a folder has no content", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Empty/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Empty/ }));

    await waitFor(() => {
      expect(screen.getByText("Empty folder")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Automation")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "System prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View .*\.png/ })).not.toBeInTheDocument();
  });

  it("filters gallery items with the search box", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.type(
      screen.getByRole("searchbox", { name: "Search files and folders by name or caption" }),
      "sunset",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
    });
  });

  it("filters subfolders with the search box", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.type(
      screen.getByRole("searchbox", { name: "Search files and folders by name or caption" }),
      "vac",
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Empty/ })).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View sunset.png" })).not.toBeInTheDocument();

    // Both section counts read "matches / total" while the search narrows them.
    expect(screen.getByLabelText("1 of 2")).toHaveClass("folder-section__count");
    expect(screen.getByLabelText("0 of 3")).toHaveClass("gallery-section__count");
  });

  it("keeps the folder section header when a search matches no folder", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.type(
      screen.getByRole("searchbox", { name: "Search files and folders by name or caption" }),
      "sunset",
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
    });

    // No folder card survives the search, but the section still reports 0 of 2.
    expect(screen.getByRole("region", { name: "Subfolders" })).toBeInTheDocument();
    expect(screen.getByLabelText("0 of 2")).toHaveClass("folder-section__count");
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");
  });

  it("leaves subfolders unfiltered when folder search is off", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    // Expand search so the in-field toggles are reachable.
    await user.keyboard("{Control>}k{/Control}");
    await user.click(screen.getByRole("button", { name: "Include folders in search" }));

    await user.type(
      screen.getByRole("searchbox", { name: "Search files by name or caption" }),
      "sunset",
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
    });

    // Folders stay fully visible; only media is narrowed. The folder count stays a
    // plain total (no "of") because nothing was filtered out of that section.
    expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Empty/ })).toBeInTheDocument();
    expect(document.querySelector(".folder-section__count")).toHaveTextContent("2");
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");
  });

  it("counts the selection against the visible media while selecting", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Select" }));

    await waitFor(() => {
      expect(screen.getByLabelText("0 of 3")).toHaveClass("gallery-section__count");
    });

    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");

    // The total stays visible once everything is selected.
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByLabelText("3 of 3")).toHaveClass("gallery-section__count");
  });

  it("filters gallery items with media type buttons", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View waves.mp4" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Videos and GIFs \(\d+\)/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View waves.mp4" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View sunset.png" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
    });
  });

  it("shows empty-folder state when a folder has subfolders but no media files", async () => {
    window.sessionStorage.setItem(
      "gallery-session-query",
      JSON.stringify({
        filter: "all",
        mediaTypeFilter: "all",
        searchQuery: "sunset",
        searchRegex: false,
      }),
    );
    const foldersOnlyHome = {
      ...homeFolder,
      items: [],
      item_count: 0,
    };
    installMockBackend({
      folderByPath: {
        undefined: foldersOnlyHome,
        [HOME_PATH]: foldersOnlyHome,
      },
    });
    await renderApp();

    await waitFor(() => {
      expect(screen.getByText("Empty folder")).toBeInTheDocument();
    });

    // The seeded search matches no folder, so the folder section is gone — but the
    // empty-folder copy still reflects the real subfolder list.
    expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
    // The media header stays put above the empty state.
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(document.querySelector(".gallery-section__count")).toHaveTextContent("0");
    expect(
      screen.getByText(
        "This folder has no supported image/video files. Drop compatible files here to import them.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Automation")).toBeInTheDocument();
  });

  it("shows caption filter empty state when subfolders are present", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /With issues/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No files with issues" })).toBeInTheDocument();
    });
  });

  it("shows media type filter empty state when subfolders are present", async () => {
    const user = userEvent.setup();
    const videoOnlyHome = {
      ...homeFolder,
      items: homeFolder.items.filter((item) => item.media_type === "video"),
      item_count: 1,
    };
    installMockBackend({
      folderByPath: {
        undefined: videoOnlyHome,
        [HOME_PATH]: videoOnlyHome,
      },
    });
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Images \(\d+\)/ }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "No images" })).toBeInTheDocument();
    });
  });

  it("filters gallery items with caption status buttons", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View beach.jpg" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Captioned \(\d+\)/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
    });
  });

  it("opens and edits the system prompt modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit instructions" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Edit instructions" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit system prompt" });
    const editor = within(dialog).getByRole("textbox", { name: "System prompt" });
    expect(within(dialog).getByRole("heading", { name: ".sysprompt" })).toBeInTheDocument();
    expect(editor).toHaveValue("Caption every image with rich detail.");

    await user.clear(editor);
    await user.type(editor, "New folder prompt.");

    await waitFor(() => {
      expect(editor).toHaveValue("New folder prompt.");
    });
  });

  it("keeps the gallery modal open after captioning on the missing-caption filter", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View beach.jpg" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Missing caption \(\d+\)/ }));

    await user.click(screen.getByRole("button", { name: "View beach.jpg" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing beach.jpg" });
    const caption = within(dialog).getByRole("textbox", { name: "Caption for beach.jpg" });
    await user.type(caption, "Sandy shoreline at dusk.");

    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining("/api/caption"),
          expect.objectContaining({ method: "PUT" }),
        );
      },
      { timeout: 3000 },
    );

    expect(screen.getByRole("dialog", { name: "Viewing beach.jpg" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
  });

  it("shows a delete confirmation when deleting from the gallery item modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(within(dialog).getByRole("button", { name: "Delete sunset.png" }));

    const confirmDialog = await screen.findByRole("alertdialog", { name: "Delete file?" });
    expect(confirmDialog).toBeVisible();
    expect(within(confirmDialog).getByText("sunset.png")).toBeVisible();
  });

  it("returns to the gallery item modal after resolving that file's issue", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const modal = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(
      within(modal).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    );

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    const caption = within(resolver).getByLabelText("Caption for sunset.png");
    await user.clear(caption);
    await user.type(caption, "Golden hour over the river");
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    // The detour ends where it started, not on the grid: same file, saved
    // caption, and the issue button gone now that the flag is cleared.
    const reopened = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await waitFor(() => {
      expect(within(reopened).getByLabelText("Caption for sunset.png")).toHaveValue(
        "Golden hour over the river",
      );
    });
    expect(
      within(reopened).queryByRole("button", { name: "Resolve caption issue for sunset.png" }),
    ).not.toBeInTheDocument();
  });

  it("returns to the gallery item modal when the resolver is dismissed unresolved", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "View sunset.png" }));

    const modal = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(
      within(modal).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    );

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(resolver).getByRole("button", { name: "Close" }));

    const reopened = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(
      within(reopened).getByRole("button", { name: "Resolve caption issue for sunset.png" }),
    ).toBeInTheDocument();
  });

  it("closes to the gallery when the issue queue was started from the automation panel", async () => {
    const user = userEvent.setup();
    installIssueBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Resolve 1 caption issue" }));

    const resolver = await screen.findByRole("dialog", {
      name: "Resolve caption issue for sunset.png",
    });
    await user.click(within(resolver).getByRole("button", { name: "Resolve" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
  });

  it("moves a file to another folder from the gallery item modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    await user.click(
      within(dialog).getByRole("button", { name: "Move sunset.png to another folder" }),
    );

    const picker = await screen.findByRole("dialog", { name: "Move to folder" });
    await user.click(await within(picker).findByRole("button", { name: "Vacation" }));
    await user.click(within(picker).getByRole("button", { name: "Move here" }));

    // The grid sorts name-asc, so sunset.png sits at index 1 and waves.mp4 slides
    // into the slot it vacates. The modal follows the slot, it does not close.
    await screen.findByRole("dialog", { name: "Viewing waves.mp4" });
  });

  it("opens and closes the gallery item modal", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "View sunset.png" }));

    const dialog = await screen.findByRole("dialog", { name: "Viewing sunset.png" });
    expect(within(dialog).getByRole("heading", { name: "sunset.png" })).toBeInTheDocument();

    await user.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Viewing sunset.png" })).not.toBeInTheDocument();
    });
  });

  it("shows an error message when folder requests fail", async () => {
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(HOME_PATH)}`);
    installMockBackend({ failFolder: true });
    await renderApp();

    await waitFor(
      () => {
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
      },
      { timeout: 10_000 },
    );
  }, 15_000);

  it("keeps folder navigation visible when a folder cannot be opened", async () => {
    const user = userEvent.setup();
    const missingPath = `${HOME_PATH}\\Missing`;
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const pathInput = within(dialog).getByRole("textbox", { name: "Folder path" });
    await user.clear(pathInput);
    await user.type(pathInput, missingPath);
    await user.click(within(dialog).getByRole("button", { name: "Open" }));

    await waitFor(
      () => {
        expect(screen.getAllByRole("alert")).toHaveLength(1);
        expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
        expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );

    await user.click(screen.getByRole("button", { name: "Photos" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 20_000);

  it("clears search with the clear button", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    const search = screen.getByRole("searchbox", {
      name: "Search files and folders by name or caption",
    });
    await user.type(search, "sunset");
    expect(search).toHaveValue("sunset");

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
  });

  it("shows favorites and lets recent folders be starred in the folder picker", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });

    await waitFor(() => {
      expect(within(dialog).getByRole("region", { name: "Favorites" })).toBeInTheDocument();
    });

    expect(
      within(dialog).getByRole("button", { name: "Remove Home from favorites" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Vacation/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Photos" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const reopenedDialog = await screen.findByRole("dialog", { name: "Open folder" });

    await waitFor(() => {
      expect(
        within(reopenedDialog).getByRole("region", { name: "Recent folders" }),
      ).toBeInTheDocument();
      expect(
        within(reopenedDialog).getByRole("button", { name: "Add Vacation to favorites" }),
      ).toBeInTheDocument();
    });

    await user.click(
      within(reopenedDialog).getByRole("button", { name: "Add Vacation to favorites" }),
    );

    await waitFor(() => {
      expect(
        within(reopenedDialog).getByRole("button", { name: "Remove Vacation from favorites" }),
      ).toBeInTheDocument();
      expect(
        within(reopenedDialog).queryByRole("button", { name: "Add Vacation to favorites" }),
      ).not.toBeInTheDocument();
    });

    await user.click(
      within(reopenedDialog).getByRole("button", { name: "Remove Vacation from favorites" }),
    );

    await waitFor(() => {
      expect(
        within(reopenedDialog).getByRole("button", { name: "Add Vacation to favorites" }),
      ).toBeInTheDocument();
    });

    const recentSection = within(reopenedDialog).getByRole("region", { name: "Recent folders" });
    const firstRecentName = recentSection.querySelector(
      ".open-folder-modal__option-name",
    )?.textContent;
    expect(firstRecentName).toBe("Vacation");
  });

  it("opens a folder from the folder picker", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const pathInput = within(dialog).getByRole("textbox", { name: "Folder path" });
    await user.clear(pathInput);
    await user.type(pathInput, VACATION_PATH);
    await user.click(within(dialog).getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return (
          new URL(requestUrl, "http://localhost").pathname === "/api/folders/contents" &&
          new URL(requestUrl, "http://localhost").searchParams.get("path") === VACATION_PATH
        );
      }),
    ).toBe(true);
  });

  it("asks for confirmation before starting an auto-caption job", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Auto-caption/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Auto-caption/ }));

    const dialog = await screen.findByRole("alertdialog", { name: "Start auto-caption?" });
    expect(dialog).toHaveTextContent(/images and videos in Photos/i);

    // default is Reasoning (thinking)
    expect(screen.getByRole("radio", { name: /Reasoning/i })).toBeChecked();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return new URL(requestUrl, "http://localhost").pathname === "/api/auto-caption";
      }),
    ).toBe(false);

    await user.click(screen.getByRole("button", { name: /Auto-caption/ }));
    await screen.findByRole("alertdialog", { name: "Start auto-caption?" });

    // select Instruct (non-thinking) and click the confirm button
    const instructRadio = screen.getByRole("radio", { name: /Instruct/i });
    await user.click(instructRadio);
    expect(instructRadio).toBeChecked();
    await user.click(screen.getByRole("button", { name: /Start auto-caption/i }));

    await waitFor(() => {
      const autoCalls = fetchMock.mock.calls.filter(([input, init]) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(requestUrl, "http://localhost");
        return (
          url.pathname === "/api/automation/auto-caption" &&
          (init?.method ?? "GET").toUpperCase() === "POST"
        );
      });
      expect(autoCalls.length).toBeGreaterThan(0);
      const last = autoCalls[autoCalls.length - 1];
      const init = last[1];
      const body = init?.body ? JSON.parse(init.body as string) : {};
      expect(body.mode).toBe("instruct");
    });
  });

  it("loads a folder from the URL path on startup", async () => {
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(EMPTY_PATH)}`);
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByText("Empty folder")).toBeInTheDocument();
    });

    expect(screen.queryByRole("region", { name: "System prompt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();
  });
});
