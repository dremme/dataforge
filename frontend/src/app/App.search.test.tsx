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

    expect(screen.getByRole("region", { name: "Subfolders" })).toBeInTheDocument();
    expect(screen.getByLabelText("0 of 2")).toHaveClass("folder-section__count");
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");
  });

  it("searches captions only and leaves subfolders unfiltered when name matching is off", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    await user.keyboard("{Control>}k{/Control}");
    await user.click(screen.getByRole("button", { name: "Match file and folder names" }));

    await user.type(screen.getByRole("searchbox", { name: "Search captions" }), "golden");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
    });

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

  it("filters gallery items with the candidates option", async () => {
    const user = userEvent.setup();
    const pendingHome = {
      ...homeFolder,
      items: homeFolder.items.map((item) =>
        item.name === "sunset.png" ? { ...item, has_candidate: true } : item,
      ),
    };
    installMockBackend({
      folderByPath: {
        undefined: pendingHome,
        [HOME_PATH]: pendingHome,
      },
    });
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View beach.jpg" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: /ComfyUI candidates \(\d+\)/ }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View beach.jpg" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "View waves.mp4" })).not.toBeInTheDocument();
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

  it("scopes the selection count to what the search leaves visible", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    await user.click(screen.getByRole("button", { name: "Select waves.mp4" }));
    expect(screen.getByLabelText("2 of 3")).toHaveClass("gallery-section__count");

    const searchbox = screen.getByRole("searchbox", {
      name: "Search files and folders by name or caption",
    });
    await user.type(searchbox, "sunset");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /waves\.mp4/ })).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Deselect sunset.png" })).toBeInTheDocument();
    expect(screen.getByLabelText("1 of 1")).toHaveClass("gallery-section__count");

    await user.clear(searchbox);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deselect waves.mp4" })).toBeInTheDocument();
    });
    expect(screen.getByLabelText("2 of 3")).toHaveClass("gallery-section__count");
  });

  it("keeps the selection when a media type filter is applied", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select waves.mp4" }));

    await user.click(screen.getByRole("button", { name: "Filter media" }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Videos and GIFs \(\d+\)/ }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /sunset\.png/ })).not.toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Deselect waves.mp4" })).toBeInTheDocument();
  });

  it("keeps the selection when the gallery switches to list view", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));

    await user.click(screen.getByRole("button", { name: "Display mode" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "List" }));

    await waitFor(() => {
      expect(document.querySelector(".gallery-virtual--list")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Deselect sunset.png" })).toBeInTheDocument();
  });

  it("inverts the selection from the section header", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");

    await user.click(screen.getByRole("button", { name: "Invert" }));

    expect(screen.getByLabelText("2 of 3")).toHaveClass("gallery-section__count");
    expect(screen.getByRole("button", { name: "Select sunset.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect beach.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect waves.mp4" })).toBeInTheDocument();
  });

  it("takes two Escape presses to leave selection mode while items are selected", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    await user.click(screen.getByRole("button", { name: "Select beach.jpg" }));
    expect(screen.getByLabelText("2 of 3")).toHaveClass("gallery-section__count");

    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("0 of 3")).toHaveClass("gallery-section__count");
    expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Exit selection mode" })).not.toBeInTheDocument();
  });

  it("leaves selection mode on a single Escape when nothing is selected", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    });
  });

  it("drops the selection when another folder is opened", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));

    await user.click(screen.getByRole("button", { name: /Vacation/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Exit selection mode" })).not.toBeInTheDocument();
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

    expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
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
