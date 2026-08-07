import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HOME_PATH, homeFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

describe("App: search and filters", () => {
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
});
