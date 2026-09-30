import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HOME_PATH, VACATION_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

async function renderAt(path?: string) {
  const user = userEvent.setup();
  installMockBackend();
  if (path) window.history.replaceState(null, "", `/?path=${encodeURIComponent(path)}`);
  await renderApp();
  await screen.findByRole("button", {
    name: path === VACATION_PATH ? "View lake.png" : "View sunset.png",
  });
  return user;
}

function currentPath() {
  return new URLSearchParams(window.location.search).get("path");
}

afterEach(() => {
  localStorage.clear();
});

describe("App: keyboard shortcuts", () => {
  it("goes to the parent folder with Alt+Up", async () => {
    const user = await renderAt(VACATION_PATH);

    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

    await screen.findByRole("button", { name: "View sunset.png" });
    expect(currentPath()).toBe(HOME_PATH);
  });

  it("goes to the home folder with Alt+Home", async () => {
    const user = await renderAt(VACATION_PATH);

    await user.keyboard("{Alt>}{Home}{/Alt}");

    await screen.findByRole("button", { name: "View sunset.png" });
    expect(currentPath()).toBe(HOME_PATH);
  });

  it("opens the folder picker with Ctrl+O, even from the search field", async () => {
    const user = await renderAt();

    await user.keyboard("{Control>}f{/Control}");
    await user.keyboard("{Control>}o{/Control}");

    expect(await screen.findByRole("dialog", { name: "Open folder" })).toBeInTheDocument();
  });

  it("starts a new folder with Alt+N", async () => {
    const user = await renderAt();

    await user.keyboard("{Alt>}n{/Alt}");

    const dialog = await screen.findByRole("alertdialog", { name: "New folder" });
    expect(within(dialog).getByRole("textbox")).toHaveValue("");
  });

  it("leaves Alt+N to a text field", async () => {
    const user = await renderAt();

    await user.keyboard("{Control>}f{/Control}");
    await user.keyboard("{Alt>}n{/Alt}");

    expect(screen.queryByRole("alertdialog", { name: "New folder" })).not.toBeInTheDocument();
  });

  it("does not navigate from behind an open dialog", async () => {
    const user = await renderAt(VACATION_PATH);

    await user.keyboard("{Control>}o{/Control}");
    await screen.findByRole("dialog", { name: "Open folder" });
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(currentPath()).toBe(VACATION_PATH);
  });

  it("lists every shortcut on ?", async () => {
    const user = await renderAt();

    await user.keyboard("?");

    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    const global = within(dialog).getByRole("region", { name: "Global" });
    expect(within(global).getByText("Open the command palette")).toBeInTheDocument();
    expect(within(global).getByText("Ctrl+P")).toBeInTheDocument();
    expect(within(dialog).getByRole("region", { name: "Review queues" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument(),
    );
  });

  it("opens the shortcut list from the palette, which shows each row's keys", async () => {
    const user = await renderAt();

    await user.keyboard("{Control>}p{/Control}");
    const palette = await screen.findByRole("dialog", { name: "Quick actions" });
    await user.type(within(palette).getByRole("combobox"), "keyboard");

    const row = within(palette).getByRole("option", { name: /Keyboard shortcuts/ });
    expect(row).toHaveAttribute("aria-keyshortcuts", "?");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
