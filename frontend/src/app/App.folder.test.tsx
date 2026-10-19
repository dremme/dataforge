import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EMPTY_PATH, HOME_PATH, VACATION_PATH, homeFolder } from "@/test/fixtures";
import { readRecentFolderPaths, touchRecentFolder } from "@/features/folder/lib/folderPreferences";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

/** jsdom has no layout; a writable `scrollTop` makes what the app writes observable. */
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

    // Same path as the poll; waiting out the real interval would cost seconds.
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
      expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Vacation/ })).not.toBeInTheDocument();
    });
  });

  it("recovers on its own when a missing folder comes back", async () => {
    const { removeFolder } = installMockBackend();
    await renderApp();
    await screen.findByRole("button", { name: /Vacation/ });

    const restore = removeFolder(HOME_PATH);
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Folder not found");
    });

    // A drive reconnected or the folder was recreated; the next check must still run.
    restore();
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
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
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Select sunrise.png" })).toBeInTheDocument();
    });

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

    expect(screen.getByRole("button", { name: "Auto-caption" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Photos" }));

    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    expect(document.querySelector(".folder-card--skeleton")).toBeNull();

    // Revalidated by asking what changed since the cached listing, not by listing again.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) => {
          const requestUrl =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          const parsed = new URL(requestUrl, "http://localhost");
          return (
            parsed.pathname === "/api/folders/changes" &&
            parsed.searchParams.get("since") === homeFolder.fingerprint
          );
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

    expect(screen.getByRole("button", { name: "Tools" })).toBeInTheDocument();
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
    touchRecentFolder(missingPath);
    await renderApp();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    });

    const recent = screen.getByRole("region", { name: "Recent folders" });
    await user.click(within(recent).getByRole("button", { name: "Missing" }));

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
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
    });
    expect(main.scrollTop).toBe(640);
  });

  it("opens a recent folder from the sidebar at the top", async () => {
    const user = userEvent.setup();
    installMockBackend();
    touchRecentFolder(VACATION_PATH);
    await renderApp();

    await screen.findByRole("button", { name: "View sunset.png" });

    const main = stubMainScroll(900);
    const recent = screen.getByRole("region", { name: "Recent folders" });
    await user.click(within(recent).getByRole("button", { name: "Vacation" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });
    expect(main.scrollTop).toBe(0);
  });

  it("deletes an empty folder from its empty state and lands on the parent", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(EMPTY_PATH)}`);
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Delete folder" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete this folder?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await screen.findByRole("button", { name: "View sunset.png" });
    expect(new URLSearchParams(window.location.search).get("path")).toBe(HOME_PATH);
    expect(screen.getByRole("button", { name: /Vacation/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Empty/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete folder" })).not.toBeInTheDocument();
  });

  it("renames an empty folder from its empty state and opens it under the new name", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(EMPTY_PATH)}`);
    installMockBackend();
    touchRecentFolder(EMPTY_PATH);
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Rename folder" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Rename folder" });
    const input = within(dialog).getByLabelText("Folder name");
    expect(input).toHaveValue("Empty");
    await user.clear(input);
    await user.type(input, "Archive");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    const renamedPath = `${HOME_PATH}\\Archive`;
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("path")).toBe(renamedPath);
    });
    expect(screen.queryByRole("alertdialog", { name: "Rename folder" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Rename folder" })).toBeInTheDocument();
    expect(readRecentFolderPaths()).not.toContain(EMPTY_PATH);
    expect(readRecentFolderPaths()).toContain(renamedPath);
  });

  it("keeps the rename dialog open with the reason when the folder name is taken", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(EMPTY_PATH)}`);
    installMockBackend();
    await renderApp();

    await user.click(await screen.findByRole("button", { name: "Rename folder" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Rename folder" });
    const input = within(dialog).getByLabelText("Folder name");
    await user.clear(input);
    await user.type(input, "vacation");
    await user.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Folder already exists");
    expect(new URLSearchParams(window.location.search).get("path")).toBe(EMPTY_PATH);
  });

  it("offers renaming only for an empty folder", async () => {
    installMockBackend();
    await renderApp();

    await screen.findByRole("button", { name: "View sunset.png" });
    expect(screen.queryByRole("button", { name: "Rename folder" })).not.toBeInTheDocument();
  });
});
