import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installMockBackend } from "@/test/mockBackend";
import { renderApp } from "@/test/renderApp";

async function renderHome() {
  const user = userEvent.setup();
  await renderApp();
  await screen.findByRole("button", { name: "View sunset.png" });
  return user;
}

async function runQuickAction(user: ReturnType<typeof userEvent.setup>, query: string) {
  await user.keyboard("{Control>}{ }{/Control}");
  const palette = await screen.findByRole("dialog", { name: "Quick actions" });
  await user.type(within(palette).getByRole("combobox"), query);
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  installMockBackend();
});

afterEach(() => {
  localStorage.clear();
});

describe("App: settings", () => {
  it("opens from the toolbar and closes without saving", async () => {
    const user = await renderHome();

    await user.click(screen.getByRole("button", { name: "Open settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByRole("radiogroup", { name: "Color scheme" })).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("opens with Ctrl+comma", async () => {
    const user = await renderHome();

    await user.keyboard("{Control>},{/Control}");

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens from the quick action bar", async () => {
    const user = await renderHome();

    await runQuickAction(user, "preferences");

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("clears the thumbnail cache from the quick action bar", async () => {
    const user = await renderHome();

    await runQuickAction(user, "clear thumbnail cache");

    expect(await screen.findByText(/Cleared 1,200 thumbnails/)).toBeInTheDocument();
  });
});
