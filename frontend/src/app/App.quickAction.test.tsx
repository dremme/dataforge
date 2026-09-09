import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as foldersApi from "@/features/folder/api/folders";
import { HOME_PATH, homeFolder, VACATION_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

async function openQuickAction(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}{ }{/Control}");
}

async function selectHomeAction(user: ReturnType<typeof userEvent.setup>, palette: HTMLElement) {
  const action = within(palette).getByRole("option", { name: "Home Go to your home folder" });
  const index = within(palette).getAllByRole("option").indexOf(action);
  await user.keyboard("{ArrowDown}".repeat(index) + "{Enter}");
}

async function waitForHomeFolder() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "View sunset.png" })).toBeInTheDocument();
  });
}

afterEach(() => {
  localStorage.clear();
});

describe("App: quick action bar", () => {
  it("navigates Home from a subfolder and retains the action in recent history", async () => {
    const user = userEvent.setup();
    installMockBackend();
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(VACATION_PATH)}`);
    await renderApp();
    await screen.findByRole("button", { name: "View lake.png" });
    const roots = vi.spyOn(foldersApi, "fetchFolderRoots");

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "home");
    await selectHomeAction(user, palette);

    await waitForHomeFolder();
    expect(roots).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("path")).toBe(HOME_PATH);
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();

    await openQuickAction(user);
    const recent = await screen.findByRole("group", { name: "Recent" });
    const homeAction = within(recent).getByRole("option", { name: "Home Go to your home folder" });
    expect(homeAction).toHaveAttribute("aria-disabled", "true");
    const historyLength = window.history.length;
    await user.click(homeAction);
    expect(screen.getByRole("dialog", { name: "Quick actions" })).toBeInTheDocument();
    expect(roots).not.toHaveBeenCalled();
    expect(window.history.length).toBe(historyLength);
  });

  it.each([undefined, "C:\\Missing"])(
    "resolves Home through the roots API after initial folder failure at %s",
    async (path) => {
      const user = userEvent.setup();
      const options = { failFolder: true };
      installMockBackend(options);
      if (path) {
        window.history.replaceState(null, "", `/?path=${encodeURIComponent(path)}`);
      }
      await renderApp();
      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
      if (path) await screen.findByText("Folder not found");

      const roots = vi.spyOn(foldersApi, "fetchFolderRoots");
      await openQuickAction(user);
      const palette = await screen.findByRole("dialog", { name: "Quick actions" });
      await user.type(within(palette).getByRole("combobox"), "home");
      options.failFolder = false;
      await selectHomeAction(user, palette);

      await waitForHomeFolder();
      expect(roots).toHaveBeenCalledOnce();
      expect(new URLSearchParams(window.location.search).get("path")).toBe(HOME_PATH);
    },
  );

  it("reports a roots failure without navigating away from a failed folder", async () => {
    const user = userEvent.setup();
    installMockBackend();
    const missingPath = "C:\\Missing";
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(missingPath)}`);
    await renderApp();
    await screen.findByText("Folder not found");
    vi.spyOn(foldersApi, "fetchFolderRoots").mockRejectedValue(new Error("Home unavailable"));
    const historyLength = window.history.length;

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "home");
    await selectHomeAction(user, palette);

    expect(await screen.findByText("Home unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
    expect(window.history.length).toBe(historyLength);
    expect(new URLSearchParams(window.location.search).get("path")).toBe(missingPath);
  });

  it("keeps Home searchable but disabled at home using equivalent folder paths", async () => {
    const user = userEvent.setup();
    installMockBackend({
      folderByPath: { undefined: { ...homeFolder, home: "c:/photos/" } },
    });
    await renderApp();
    await waitForHomeFolder();
    const roots = vi.spyOn(foldersApi, "fetchFolderRoots");
    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "go to your home folder");
    const action = within(palette).getByRole("option", { name: "Home Go to your home folder" });

    expect(action).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Enter}");
    await user.click(action);
    expect(roots).not.toHaveBeenCalled();
    expect(palette).toBeInTheDocument();
  });

  it.each(["root", "unloaded"])("keeps the parent action disabled for %s", async (state) => {
    const user = userEvent.setup();
    installMockBackend({
      failFolder: state === "unloaded",
      folderByPath: { undefined: { ...homeFolder, path: "C:\\", parent: null } },
    });
    await renderApp();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "go to parent folder");
    const action = within(palette).getByRole("option", { name: /Go to parent folder/ });
    const historyLength = window.history.length;

    expect(action).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Enter}");
    await user.click(action);
    expect(palette).toBeInTheDocument();
    expect(window.history.length).toBe(historyLength);
  });

  it("enables the parent action when a parent exists and navigates there", async () => {
    const user = userEvent.setup();
    installMockBackend();
    window.history.replaceState(null, "", `/?path=${encodeURIComponent(VACATION_PATH)}`);
    await renderApp();
    await screen.findByRole("button", { name: "View lake.png" });
    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "go to parent folder");

    expect(
      within(palette).getByRole("option", { name: /Go to parent folder/ }),
    ).not.toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Enter}");
    await waitForHomeFolder();
    expect(new URLSearchParams(window.location.search).get("path")).toBe(HOME_PATH);
  });

  it("opens on Ctrl+Space and navigates into a subfolder on Enter", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);

    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "vacation");

    await waitFor(() => {
      expect(within(palette).getByRole("group", { name: "Subfolders" })).toBeInTheDocument();
    });

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "View lake.png" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
  });

  it("opens a job's dialog, the same one the automation menu opens", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);

    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "set captions");
    await user.keyboard("{Enter}");

    await screen.findByRole("alertdialog", { name: "Set captions?" });
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
  });

  it("routes a confirm-only job type to its confirmation instead of a dialog", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);

    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "strip metadata");
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("alertdialog", { name: "Start strip metadata?" }),
    ).toBeInTheDocument();
  });

  it("remembers what was run and offers it first the next time", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);
    let palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "refresh folder");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
    });

    await openQuickAction(user);
    palette = await screen.findByRole("dialog", { name: "Quick actions" });

    const recent = within(palette).getByRole("group", { name: "Recent" });
    expect(within(recent).getAllByRole("option")[0]).toHaveTextContent("Refresh folder");
  });

  it("offers a job started from the automation menu in the empty palette", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(screen.getByRole("button", { name: /More/ }));
    await user.click(screen.getByRole("menuitem", { name: /Find & replace/ }));
    await screen.findByRole("alertdialog", { name: "Find and replace in captions?" });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("alertdialog", { name: "Find and replace in captions?" }),
      ).not.toBeInTheDocument();
    });

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    const recent = within(palette).getByRole("group", { name: "Recent" });
    expect(within(recent).getAllByRole("option")[0]).toHaveTextContent("Find & replace");
  });

  it("stays shut while a dialog is open, and opens again once it is dismissed", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(screen.getByRole("button", { name: "Open folder" }));
    await screen.findByRole("dialog", { name: "Open folder" });

    await openQuickAction(user);
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Open folder" })).not.toBeInTheDocument();
    });

    await openQuickAction(user);
    expect(await screen.findByRole("dialog", { name: "Quick actions" })).toBeInTheDocument();
  });

  it("toggles closed on a second Ctrl+Space", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);
    await screen.findByRole("dialog", { name: "Quick actions" });

    await openQuickAction(user);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
    });
  });

  it("lists selection actions disabled until files are selected", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "selected");

    for (const name of ["Move selected files", "Copy selected files", "Delete selected files"]) {
      expect(within(palette).getByRole("option", { name: new RegExp(name) })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    }
  });

  it("lists delete, move and copy once a file is selected", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "selected");

    const rows = within(palette)
      .getAllByRole("option")
      .map((row) => row.textContent ?? "");

    expect(rows.some((row) => row.startsWith("Move selected files"))).toBe(true);
    expect(rows.some((row) => row.startsWith("Copy selected files"))).toBe(true);
    expect(rows.some((row) => row.startsWith("Delete selected files"))).toBe(true);
    expect(rows.filter((row) => row.includes("1 selected file"))).toHaveLength(3);

    for (const name of ["Move selected files", "Copy selected files", "Delete selected files"]) {
      expect(within(palette).getByRole("option", { name: new RegExp(name) })).not.toHaveAttribute(
        "aria-disabled",
      );
    }
  });

  it("selects every visible file and enters selection mode", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "select all");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Exit selection mode" })).toBeInTheDocument();
    expect(screen.getByLabelText("3 of 3")).toHaveClass("gallery-section__count");
  });

  it("leaves invert selection disabled until selection mode is on", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "invert");

    expect(within(palette).getByRole("option", { name: /Invert selection/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("inverts the visible selection from the palette", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));
    expect(screen.getByLabelText("1 of 3")).toHaveClass("gallery-section__count");

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "invert selection");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText("2 of 3")).toHaveClass("gallery-section__count");
    expect(screen.getByRole("button", { name: "Select sunset.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect beach.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect waves.mp4" })).toBeInTheDocument();
  });

  it("opens the delete confirmation for the selection from the palette", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "delete selected");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alertdialog", { name: "Delete file?" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Quick actions" })).not.toBeInTheDocument();
  });

  it("opens the destination picker for a move from the palette", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await user.click(screen.getByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("button", { name: "Select sunset.png" }));

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "move selected");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog", { name: "Move to folder" })).toBeInTheDocument();
  });

  it("opens the folder picker from the palette", async () => {
    const user = userEvent.setup();
    installMockBackend();
    await renderApp();
    await waitForHomeFolder();

    await openQuickAction(user);
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "open folder");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog", { name: "Open folder" })).toBeInTheDocument();
  });
});
