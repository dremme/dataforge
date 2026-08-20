import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

/** The palette binds Ctrl+Space at the window, so no element needs focus first. */
async function openQuickAction(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}{ }{/Control}");
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

    // No query typed, so this is the persisted recent list, not a search result.
    const recent = within(palette).getByRole("group", { name: "Recent" });
    expect(within(recent).getAllByRole("option")[0]).toHaveTextContent("Refresh folder");
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

    // Read whole rows rather than text nodes: the query match is wrapped in a
    // <mark>, which splits the label across elements.
    const rows = within(palette)
      .getAllByRole("option")
      .map((row) => row.textContent ?? "");

    expect(rows.some((row) => row.startsWith("Move selected files"))).toBe(true);
    expect(rows.some((row) => row.startsWith("Copy selected files"))).toBe(true);
    expect(rows.some((row) => row.startsWith("Delete selected files"))).toBe(true);
    // The count is what tells the user what the action will act on.
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
