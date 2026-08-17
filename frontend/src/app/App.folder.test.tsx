import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EMPTY_PATH, HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

/**
 * jsdom has no layout, so the app's scroll container never moves on its own.
 * A writable `scrollTop` makes what the app writes observable.
 */
function stubMainScroll(scrollTop = 0): HTMLElement {
  const element = document.querySelector("main.main") as HTMLElement;
  Object.defineProperty(element, "scrollTop", {
    value: scrollTop,
    writable: true,
    configurable: true,
  });
  return element;
}

describe("App: folder navigation", () => {
  it("shows folder not found when the current folder is deleted in the background", async () => {
    const { removeFolder } = installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    removeFolder(HOME_PATH);

    // The change detector re-checks the moment the tab becomes visible, which is
    // the same code path as its 3s poll. Waiting out the real interval here would
    // cost 3s; useFolderChangeDetection.test.ts owns the timer itself.
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
      expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
    });
  });

  it("drops a selected file from the selection when it is renamed in the background", async () => {
    const user = userEvent.setup();
    const { renameItem } = installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    await user.click(screen.getByRole("button", { name: "Select beach.jpg" }));
    expect(screen.getByLabelText("2 of 3")).toHaveClass("gallery-section__count");

    renameItem(HOME_PATH, "sunset.png", "sunrise.png");
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select sunrise.png" })).toBeInTheDocument();
    });

    // Nothing on disk answers to the old name any more, so it cannot stay in the
    // selection: a move or delete built from it would fail on a file the user can see.
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");
    expect(screen.getByRole("button", { name: "Deselect beach.jpg" })).toBeInTheDocument();
  });

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

    // Exact name: the crumb's chevron is "Subfolders of Photos" and would match a regex.
    await user.click(screen.getByRole("button", { name: "Photos" }));

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

  it("shows an error message when folder requests fail", async () => {
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(HOME_PATH)}`);
    installMockBackend({ failFolder: true });
    await renderApp();

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
    });
  });

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

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
      expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Photos" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Photos" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("opens a subfolder at the top rather than where the last folder was left", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    const main = stubMainScroll(900);
    await user.click(screen.getByRole("button", { name: /Vacation/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });
    expect(main.scrollTop).toBe(0);
  });

  it("returns each history entry to the offset it was left at", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    const main = stubMainScroll(900);
    await user.click(screen.getByRole("button", { name: /Vacation/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });

    main.scrollTop = 300;
    window.history.back();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
      expect(main.scrollTop).toBe(900);
    });

    window.history.forward();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
      // A cache keyed by folder path rather than by history entry gets this wrong.
      expect(main.scrollTop).toBe(300);
    });
  });

  it("leaves the scroll position alone when a folder refreshes in place", async () => {
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    const main = stubMainScroll(640);
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });
    expect(main.scrollTop).toBe(640);
  });

  it("opens a folder from the open-folder dialog at the top", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    const main = stubMainScroll(900);
    await user.click(screen.getByRole("button", { name: "Open folder" }));

    const dialog = await screen.findByRole("dialog", { name: "Open folder" });
    const pathInput = within(dialog).getByRole("textbox", { name: "Folder path" });
    await user.clear(pathInput);
    await user.type(pathInput, VACATION_PATH);
    await user.click(within(dialog).getByRole("button", { name: "Open" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });
    // The modal scroll lock restores the pre-open offset on close; the reset has
    // to land after that, not before.
    expect(main.scrollTop).toBe(0);
  });
});
